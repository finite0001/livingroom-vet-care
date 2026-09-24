# Native dispensing ledger integration audit

Read-only source audit at cancellation/replacement checkpoint `099c51f`; no dispensing implementation or clinical acceptance is claimed.

## Existing ledger contracts

`supabase/migrations/20260913000000_inventory_billing.sql` defines immutable product kind/unit, versioned active catalog pricing (`unit_price_cents` bigint, 0–100,000,000), immutable lot metadata and signed `numeric(14,3)` movements. Stock balance is the movement sum. Invoice items have positive quantity and generated `round(quantity * unit_price_cents)::bigint` amounts. Invoice updates advance their revision through `inventory_guard`; inserting an item alone does not advance the invoice.

Neither movement nor invoice item has a native prescription dispense reference. New immutable dispense/allocation records must explicitly bind actual movement/item IDs; matching description text is insufficient. Existing treatments reuse UUIDs but must not be created for take-home dispensing.

## Effective lock order

| Existing writer | Order |
|---|---|
| Receive inventory | request gate → product SHARE → lot UPDATE |
| Adjust inventory | request gate → lot UPDATE → recompute balance |
| Add service charge | request gate → invoice UPDATE → product SHARE |
| Issue invoice | invoice UPDATE → exact revision/draft validation → sum/issue |
| Record patient treatment | patient SHARE through alert review → invoice UPDATE → patient SHARE → lot UPDATE → product SHARE |

The treatment row above includes the effective `20260913260000_treatment_alert_review.sql` patch. Do not copy the original invoice-first order. Prescription authorization/slot serialization precedes fulfillment locks. Sort multiple lot UUIDs and preserve compatible patient SHARE locks.

## Required implementation decisions

- Freeze and compare exact invoice revision plus catalog revision/price; reject changed prices rather than silently using live values.
- Require draft invoice/current household and increment invoice version once after adding the charge. A competing invoice issue must fail one side on currentness.
- Charge once per dispense event, independent of lot splits, unless a different explicit financial contract is reviewed: rounding each lot separately can change cents.
- Reject excessive quantity precision before numeric casts; bound the quantity×price calculation before bigint conversion.
- Recompute stock after locking each lot. Check lot/order validity using the explicit Denver-date contract and recorded event date.
- Commit native event, slot consumption, allocation/movement links, invoice item and invoice revision together. No treatment administration, due-plan, outbox or provider work.

## Corrections and payment boundaries

`20260913300000_payment_ledger.sql` adds invoice collection guards: credits/voids lock invoices; unresolved checkout blocks corrections, and payment history blocks void. `20260913330000_payment_reconciliation_observations.sql` adds reconciliation guards for credits. Clinical correction, physical stock adjustment, financial credit and refund remain separate linked actions; none automatically restores prescription allowance.

`20260913150000_invoice_documents.sql` preserves quantity/cents as strings. New receipts must retain that precision convention. This audit prepares the full dispensing phase after native refill intake; it does not reduce the remaining workflow or acceptance requirements.

## Additive118 verification

`20260916070108_inventory_product_before_lot_locking.sql` changes current-care treatment to product SHARE before lot UPDATE, preserving patient/alert and invoice locking. Receive, adjust and treatment also recheck active staff after their request gate, including exact retries. Existing clinical/stock/charge data remain unchanged by this function-definition migration.

The original queued-update blocking assumption was not observed: PostgreSQL permits compatible product SHARE acquisition while catalog UPDATE waits. The real three-writer test now checks exact product-row ownership before the treatment's lot wait using `pgrowlocks` in an owned schema clone. Both arrival schedules complete with exact stock, protected prices and alert history; three role-revoked retries are rejected. All32 checks pass. A negative control reconstructing only the prior treatment lock order fails the exact product-ownership assertion. This establishes the tested ordering, not a reproduced deadlock in the old code or acceptance of the future dispensing implementation.
