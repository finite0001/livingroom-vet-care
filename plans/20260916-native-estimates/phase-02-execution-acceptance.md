# Phase 3–4: accepted work, pricing and complete acceptance

Priority: required for usable estimates, not an optional service-only extension. Status: design only; depends on immutable publication/decision identities.

## Design and affected code

Create accepted-line authorizations and execution plans under the estimate module from [phase1](phase-01-lifecycle-approval.md). Each line binds the accepted revision, exact product/kind/unit, quantity, frozen description and allocated price/amount. Consumption records bind an actual service/treatment/dispense and one invoice item, with actor, quantity, charged cents, cumulative usage before/after and pricing basis. Retain explicit unused-quantity closure and replacement history.

Required existing paths to extend with versioned contracts:

- `supabase/migrations/20260913000000_inventory_billing.sql`: service/treatment and generated invoice-item amounts currently use current catalog price. Implement additive successors, not edits to deployed files or wrappers that retain the wrong pricing behavior.
- `supabase/migrations/20260916072509_native_fulfillment.sql`: dispense preview/record and `native_fulfillment_verified_dispense` currently bind current price. Add an accepted-price basis while preserving old receipt validation.
- `src/hub/features/prescriptions/fulfillment-api.ts` and native fulfillment UI: strict versioned pricing-basis and accepted-line selection; preserve stock, allowance, refill and clinical review.
- Invoice rendering/validation and selected release contracts: disclose actual accepted-price provenance and any rounding allocation. Never reinterpret old artifacts using current prices.
- Native finance paths: credits remain capped by the immutable actual charge; physical returns and financial credits never reopen accepted quantities implicitly.

No provider SDK, ezyVet synchronization or live secret is required for this implementation.

## Atomic execution

1. Accepted revision creates an execution plan and target draft invoice without prebilling medication/vaccine lines or reserving stock.
2. Service completion consumes an accepted allowance and creates its charge atomically.
3. Actual vaccine/medication administration consumes the accepted allowance, appends the treatment, moves stock and creates one charge atomically. Historical treatment entry does not bill.
4. A prescription dispense retains clinician authorization, product match, slot allowance, inventory lot and expiry checks, and consumes the quoted allowance alongside its usual single charge.
5. Unestimated extras require an explicitly reviewed current-price action. Product similarity never implies substitution permission. Each actual treatment/dispense event initially uses one explicit pricing source; mixed quoted/unquoted quantities require separately recorded partial events whose clinical quantities and stock debits sum to the actual work. Do not duplicate a full clinical event for each charge segment. A future one-to-many invoice model requires its own versioned clinical/financial contract.
6. Inactive products and clinical constraints can block performance without rewriting the accepted commercial terms. Changing catalog prices never changes accepted prices.

## Decimal quantities and allocation

Freeze the pricing basis before acceptance. For unit-priced lines, cumulative used quantity `u`, new quantity `q` and accepted unit cents `P`, charge `round((u+q)*P) - round(u*P)`; the accepted line total must equal `round(Q*P)` for approved quantity `Q`. For allocated package/discount lines with accepted amount `A`, use a frozen cumulative allocation such as `F(x)=round(A*x/Q)` and charge `F(u+q)-F(u)`. Require nonnegative charges, a valid positive `Q`, and exact final total `A`. Complete consumption must equal the accepted amount even when work is split into fractional quantities.

The current generated invoice amount `round(quantity*unit_price_cents)` cannot represent every cumulative allocation. Introduce an explicit validated allocation-backed rounding basis/adjustment; do not fake clinical quantity or unit price. Discount/package allocations must be frozen to executable lines before acceptance; summing allocated amounts must equal the accepted total. Currency precision, decimal scale, overflow and negative/zero allocations require explicit contract tests.

## Cancellation, replacement and partial invoices

Cancel unused quantities without a credit or stock change. Completed work remains consumed even if later credited/refunded/returned; a replacement allowance requires a separate reviewed action. Prescription replacement does not transfer commercial authorization automatically.

Publishing a replacement freezes old unused allowances. Its newly accepted residual lines must explicitly account for completed work, preventing both revisions from authorizing the same quantity. Each successor line references its immutable predecessor, consumed-head snapshot and exactly retired/transferred residual quantity. Transfer is atomic and can occur only once. If a replacement is declined/withdrawn, reopening old unused allowances must atomically retire any successor residual authorization and respect the original accepted terms. An audit note alone cannot prevent overlapping active quantities.

Issue only performed work. Partial invoice review discloses outstanding approved quantities; later performance can bill to another same-household draft invoice under the same global allowance ceiling. Invoice issue/replacement/consumption races must preserve both monetary and quantity ceilings. Deposits/prepayments remain separate payment allocation work, not pretend performed services.

## Locks and recovery

Proposed order to validate against the complete existing call graph before SQL implementation: operation advisory locks → estimate root/revision → sorted accepted-line locks → refill → prescription authorization → patient/household → invoice → sorted products/lots. Never call an unchanged nested RPC that acquires an earlier lock while holding a later one. Invoice issue/convert operations must discover every relevant estimate root and line and acquire them in deterministic order before the invoice lock; an invoice may include multiple estimates. Existing `issue_billing_invoice` begins with the invoice lock, so do not insert earlier entitlement locks inside it. Recheck invoice membership after locking and retry on change. Final staff authority, expiry/availability and reviewed context checks occur after all waits.

Exact operation receipts are immutable and recoverable. Unknown responses preserve request identity; committed work is neither duplicated nor silently reversed. Concurrent service/treatment/dispense allocations share the same accepted-line ceiling, including different invoices.

## Acceptance and rollout checklist

- [ ] All three actual-work paths consume accepted prices; one charge per performed allocation and no charge at acceptance.
- [ ] Catalog price changes, fractional partial work, discount allocations and cross-invoice consumption preserve exact totals.
- [ ] Prescription cancellation/replacement, lot expiry, inactive product and patient alerts remain effective.
- [ ] Observed contention covers service/service, dispense/dispense, treatment/dispense, publish replacement/consume, issue/consume and role revocation while waiting.
- [ ] Lost replies/reload recover exact execution; changed actor/target/request IDs fail; no unsafe browser discard.
- [ ] Existing native credits/refunds, returns, stock, allowance and frozen releases remain compatible with both old and new pricing contracts.
- [ ] Staff/client browser journey: draft → publish → exact delivery → acceptance → partial service/vaccine/dispense → invoice → remaining approved work → final charge.
- [ ] Actual local Auth/HTTP/database and populated restore prove execution links, immutable artifacts, financial totals and access boundaries.
- [ ] Full integrated stack CI and migration inventory checked before coordinated rollout; independent communications branches preserved.

Synthetic acceptance is necessary but not sufficient for commercial readiness. Hosted staff rehearsal, clinical/business approval, provider delivery/payment tests and the broader standalone feature inventory remain required.
