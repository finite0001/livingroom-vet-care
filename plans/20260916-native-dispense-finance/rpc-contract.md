# Native dispense finance RPC contract v1

Frozen implementation contract, 2026-09-16. Scope: reviewed accounting credits and separately prepared refund reservations. No provider calls, stock changes, allowance changes, or edits to original dispense/item records. This document owns public JSON shapes; internal table names remain implementation choices.

## Scalars and closed shapes

All objects below reject missing or additional keys. `UUID` is a canonical lowercase UUID; `Hash` is 64 lowercase hexadecimal characters; `Timestamp` is a finite ISO timestamp with timezone. `Cents` is a canonical nonnegative integer string (`0|[1-9][0-9]*`), individually at most 9223372036854775807. `PositiveCents` excludes zero. Use PostgreSQL numeric for intermediate aggregate arithmetic, bigint for ledger inserts, and frontend BigInt. Never round money through Number. Currency is exactly `usd`. New native Intent/Result reasons are trimmed nonempty strings of at most 2000 characters. Existing ledger Credit/Refund projections preserve the exact raw reason; only its trimmed length must be 1–2000 characters, matching the generic ledger constraints. Surrounding whitespace in historical generic reasons is not silently normalized or rejected. Object order is irrelevant; array ordering is specified below. IDs in one array must be unique.

```ts
interface Target { authorization_id: UUID; pet_id: UUID; dispense_id: UUID }
interface Head { event_id: UUID | null; version: number; record_hash: Hash | null }
// Empty head is exactly {event_id:null,version:0,record_hash:null}; otherwise
// version is a positive safe integer and both nullable fields are nonnull.
interface Intent {
  target: Target;
  action: 'credit' | 'refund';
  amount_cents: PositiveCents;
  reason: string;
  credit_id: UUID | null;
  payment_id: UUID | null;
}
interface Request { intent: Intent; expected_context_hash: Hash; attest_review: true }
interface Credit {
  id: UUID; amount_cents: PositiveCents; reason: string;
  actor_id: UUID; created_at: Timestamp;
  dispense_id: UUID | null;
}
interface Payment {
  id: UUID; amount_cents: PositiveCents; remaining_cents: Cents;
}
interface Refund {
  id: UUID; payment_id: UUID; amount_cents: PositiveCents;
  reason: string; actor_id: UUID; created_at: Timestamp;
  state: 'pending' | 'failed' | 'succeeded' | 'reconciliation';
  settled: boolean;
  credit_id: UUID | null;
  dispense_id: UUID | null;
}
interface Balance {
  obligation_cents: Cents; paid_cents: Cents; refunded_cents: Cents;
  net_cash_cents: Cents; outstanding_cents: Cents;
  pending_refund_cents: Cents; refundable_cents: Cents;
}
interface Snapshot {
  target: Target;
  authorization_hash: Hash;
  dispense_document_hash: Hash;
  invoice: {
    id: UUID; client_id: UUID; item_id: UUID; version: number;
    status: 'draft' | 'issued' | 'void'; currency: 'usd';
    total_cents: Cents | null; item_amount_cents: Cents;
  };
  source_heads: { correction: Head; returns: Head; discrepancy: Head };
  clinical_context_hash: Hash;
  financial_context_hash: Hash;
  credits: Credit[];
  payments: Payment[];
  refunds: Refund[];
  balance: Balance | null;
  capacity: {
    linked_credit_cents: Cents;
    unallocated_credit_cents: Cents;
    item_credit_capacity_cents: Cents;
    invoice_credit_capacity_cents: Cents;
    credit_capacity_cents: Cents;
  };
  blockers: string[];
}
interface Context { snapshot: Snapshot; intent: Intent; eligible_amount_cents: Cents }
interface Preview {
  version: 1; actor_id: UUID; observed_at: Timestamp;
  context: Context; context_hash: Hash; allowed: boolean; blockers: string[];
}
interface Result {
  id: UUID; target: Target; action: 'credit' | 'refund';
  actor_id: UUID; created_at: Timestamp;
  invoice_id: UUID; invoice_item_id: UUID;
  credit_id: UUID; refund_request_id: UUID | null; payment_id: UUID | null;
  amount_cents: PositiveCents; currency: 'usd'; reason: string;
  reviewed_context: Context; reviewed_context_hash: Hash;
  record_hash: Hash;
}
interface Receipt {
  version: 1; id: UUID; actor_id: UUID; request: Request;
  request_hash: Hash; result: Result; created_at: Timestamp;
}
interface Read {
  version: 1; actor_id: UUID; snapshot: Snapshot;
  results: Result[];
}
```

Credit intent requires null credit_id/payment_id. Refund intent requires both IDs, where credit_id is a verified native credit for the exact target and payment_id is a captured payment for the derived invoice. Invalid/cross-target identifiers are rejected, not rendered as selectable blocked options. Refund input additionally cannot exceed 99999999 cents, matching the existing provider/payment boundary. Zero-charge dispenses remain readable but cannot receive a positive credit.

Credits/payments/refunds in Snapshot cover the entire derived invoice, sorted by UUID ascending; credits/refunds use null attribution for generic entries. An attributed refund has both attribution IDs nonnull. Results cover the exact dispense only, sorted by created_at then id ascending. For this bounded initial workflow read returns complete history; no silent truncation or guessed partial capacities. No names/contact details/current catalog price are required to calculate this snapshot.

## RPCs

- `preview_native_dispense_finance(p_intent jsonb) -> Preview`.
- `record_native_dispense_finance(p_id uuid, p_request jsonb) -> Receipt`.
- `recover_native_dispense_finance(p_id uuid) -> Receipt | null` (null only when no own operation exists; other actors' operations are unavailable).
- `read_native_dispense_finance(p_authorization_id uuid,p_pet_id uuid,p_dispense_id uuid) -> Read`.

All four require active staff. Writes derive actor from auth.uid(); existing generic active-staff permissions are preserved. Recovery is creator-only; read is active-staff-visible. Missing or mismatched source targets raise 23514/42501 and never produce a partially trusted snapshot. Readers verify immutable links rather than simply return table JSON.

## Snapshot derivation and review binding

Derive invoice, item, household and original charge using `native_fulfillment_verified_dispense`; never accept them in intent. Verify corrections through `native_correction_verified` and returns/discrepancies through `native_reconciliation_verified`. Heads come from their verified contexts. `clinical_context_hash` hashes the complete verified correction context and current verified reconciliation read using `native_fulfillment_hash(jsonb_build_object('authorization_head',public.native_fulfillment_head(authorization_id),'corrections',correction_context,'returns',reconciliation_read))`. This additionally binds pickup information and current source evidence that a head alone may omit. An open clinical discrepancy is disclosed and hash-bound; it does not automatically prohibit a separately reasoned accounting credit. No current active-prescription/patient/product requirement is imposed on historical financial adjustments.

`financial_context_hash` is `payment_reconciliation_hash_internal(invoice_id)` for issued/void invoices. For a draft use `native_fulfillment_hash` of its invoice row, immutable items, credits, payments and refund requests; draft has null total/balance and is blocked. This avoids invoking invoice document APIs requiring an issued document. The financial hash must change for provider evidence, blocker resolution and generic transactions, including changes that leave the net amount unchanged.

`context_hash = native_fulfillment_hash(context)`; observed_at is excluded. Preview allowed is exactly blockers empty. Preview blockers are the deduplicated, lexically sorted union of Snapshot blockers and action-specific blockers. Snapshot blockers are stable codes from: `invoice_not_issued`, `checkout_unresolved`, `payment_reconciliation`. Action-specific codes: `credit_capacity_exceeded`, `refund_capacity_exceeded`. An amount greater than eligible capacity produces a blocked preview, not a mutation. Read may show empty capacity without an action-specific blocker.

`checkout_unresolved` means any invoice checkout state outside paid/expired. `payment_reconciliation` means any open invoice observation, open quarantined checkout/refund evidence, or effective checkout/refund reconciliation state. Use current resolved-blocker helpers, not existence of historical evidence. All original ledger trigger guards remain effective.

Invoice total null only for draft. Issued/void capacity is derived from total and credits, but eligibility is zero unless issued and Snapshot blockers are empty. `invoice_credit_capacity_cents` is zero for draft. Existing balance calculation is returned for issued/void; status separately controls eligibility. UI must not interpret a void invoice's calculated balance as collectible.

## Capacity arithmetic

Let D be original invoice-item charge, L sum of verified native credits attributed to this dispense, U sum of invoice credits having no native attribution, T invoice total, and C all invoice credits. Then:

```
item_credit_capacity = max(0, D - L - U)
invoice_credit_capacity = max(0, T - C)
credit_capacity = min(item_credit_capacity, invoice_credit_capacity)
```

Native credits for other dispenses consume invoice capacity but not this item's capacity. Generic credits remain unallocated; display why U conservatively consumes possible item capacity. Never convert historical generic credit into native credit by inference. Crediting reduces obligation, not cash. No proportional quantity-based credit calculation is introduced.

For refund intent, credit remaining is credit amount minus amounts of its linked requests that are settled OR have effective state other than failed. Count each request once. Selected payment remaining mirrors `prepare_invoice_refund`: payment amount minus all its requests whose effective state is not failed. Invoice refundable is existing `payment_balance_internal()->refundable_cents`.

```
refund_capacity = max(0, min(credit_remaining, selected_payment_remaining,
                           invoice_refundable, 99999999))
```

Preview eligible amount is action capacity when Snapshot blockers are empty and invoice issued, else zero. Pending, uncertain, paused, and retry-window-expired requests continue consuming capacity. There is no custom uncertain SQL state: an unresolved submission remains pending/reconciliation. Effective failed with no settlement releases linked capacity. Confirmed refunds permanently consume linked capacity, even if subsequently displayed as reconciliation; they must not be double-counted as pending. Open reconciliation can conservatively re-reserve an otherwise failed request. Generic refunds consume payment/invoice cash capacity without acquiring invented credit attribution. No failed-request ID is reused for a new intent: a new reviewed reservation requires a new UUID after confirmed failure.

## Locks and mutation/recovery

Use p_id as the underlying credit ID for credit, and underlying refund request ID for refund. No second caller-supplied ledger-operation UUID exists. Acquire:

1. Bare operation lock `hashtextextended(p_id::text,0)`.
2. For both actions, request lock `hashtextextended(p_id::text,3003)`. This also serializes a native credit against a same-ID generic refund before checking either ledger for existing rows.
3. Recheck active staff; if exact native operation exists verify and recover it, regardless of subsequent capacity/source changes. Changed actor/request reuse is rejected.
4. Authorization lock `hashtextextended('native-prescription-authorization:'||authorization_id::text,0)`.
5. Derived invoice row FOR UPDATE.
6. Recheck staff; rebuild snapshot/intent context and compare expected_context_hash. Reject stale context with 40001 before any mutation. Check explicit attestation and allowed status.
7. Invoke existing credit_billing_invoice or prepare_invoice_refund; the nested operation/invoice locks are already held. Record native attribution and immutable receipt in the same transaction. Recheck staff before finishing.

Preview/read use authorization then invoice lock when needed to obtain a coherent current snapshot; they must not acquire operation locks afterward or call mutation functions. Avoid product/lot/refill row locks: financial reads do not change their state. Existing native return v2 uses bare seed-0 operation locks before authorization, which is why step 1 must precede step 4. Generic financial RPCs lock request IDs before invoice, which is why step 2 cannot follow step 5.

If either underlying same-ID credit or refund request already exists without an exact native operation, reject 23514; do not adopt generic history even when amount/reason match. Same-operation concurrency serializes and returns one receipt; generic/native same-ID races yield either exact native success or refusal to adopt the generic record.

## Frozen evidence and error behavior

Result created_at/actor/amount/reason must match its existing financial ledger row. created_at retains the existing ledger transaction timestamp (now()), which may precede preview observed_at; no post-preview timestamp ordering is asserted. A shared native operation identity rejects cross-action ID reuse. Credit result: credit_id=id, refund_request_id/payment_id=null. Refund result: refund_request_id=id and credit_id/payment_id equal intent IDs. Result id equals receipt id; result target/action/reason/amount exactly match request intent. The recorded reviewed_context equals the accepted preview context, not a recomputed post-credit balance.

`result.record_hash = native_fulfillment_hash(result - 'record_hash')`.
`receipt.request_hash = native_fulfillment_hash({version:1,actor_id,operation:'record_native_dispense_finance',request})`.
`receipt.created_at = result.created_at`. Frozen result never embeds mutable provider outcome. Current refund state comes only from Snapshot refunds; therefore recovery after settlement returns the same receipt. Read/recover verify request/result hashes, actor/target/intent bindings, original dispense/item linkage, underlying credit/refund linkage and native credit attribution. They do not compare a historical reviewed context to today's current heads/hash.

23514: malformed request, invalid target/source/attribution, changed-ID reuse, forbidden adoption, blocked/capacity violation or evidence integrity failure. 42501: authentication/active-staff/creator denial. 40001: stale review. 23505 is a definite rejected conflict unless exact receipt recovery proves a committed operation. Unknown transport/server outcomes must preserve the exact pending UUID/request, then recover before permitting a replacement. Persist intent before sending, scoped by actor and exact target. Never label a reservation as a completed refund or automatically submit it to Stripe.

## Required acceptance cases

### Terminal resolution of an uncertain request

`close_native_dispense_finance(p_id,p_request)` accepts the exact original saved request, with the same bare0 → seed3003 operation locks as record. Under those locks it rechecks staff and either returns `{version:1,status:'recorded',receipt}` or `{version:1,status:'closed_unrecorded',closure}`. Closure contains version1, ID, actor, original request, original request hash, post-lock closed_at and record_hash over the other closure fields. It is immutable, audited and independently verified against the original dispense target; it deliberately does not require the old financial review to remain current.

The record path checks for a durable closure before any ledger effect and permanently refuses a closed UUID. A write that wins the lock is recovered, not cancelled; a write that rolls back can be closed. A closure that rolls back cannot block a later write. Closure attests absence of a **native** financial operation with that ID, not absence of unrelated generic ledger history.

Only a strictly validated recorded/closed response permits browser intent cleanup. A null recovery, malformed response or uncertain close preserves the original request. Lost closure responses recover through the identical close call; existing receipt-or-null recovery stays backward compatible. Closing does not reverse a credit, issue a refund, reserve capacity or change clinical/stock records. Require fresh preview/attestation after closure while retaining the local draft.

Required additional cases: stale-review permanent-loop escape, close/write races in both orders, rollback in both orders, delayed write rejection, exact retry, changed actor/request denial, malformed/lost close browser responses and populated closure restore.

Exact source tampering; stale clinical/financial hash; generic/native credit races; same-ID generic/native and return/native lock contention; two dispenses sharing invoice; refund reservation competition; failed/uncertain/reconciliation/settled transitions; unallocated credit conservatism; staff revocation while waiting; creator-only recovery; immutable historical receipts; lost-response reload recovery; unchanged original dispense/item/stock/allowance; current financial status separate from frozen receipt. No provider action is required for these tests.
