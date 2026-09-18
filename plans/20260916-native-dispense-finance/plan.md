# Native dispense financial adjustments

Status: implemented candidate, acceptance in progress. Reconciliation PR151 passed all CI jobs at ce82da6 (run35088142107). This is independent practice software; no ezyVet connection, provider activation or credential change is required.

## Outcome

Staff can review and record an accounting credit against an exact native dispense, inspect its immutable attribution, recover uncertain submissions and separately prepare an eligible refund through the existing payment workflow. A credit reduces the amount owed; a reserved refund is not evidence that money has returned to a client. Neither action changes stock, physical return history or prescription allowance.

## Inspected foundation

- `supabase/migrations/20260916072509_native_fulfillment.sql`: each dispense identifies its invoice and unique invoice item. `native_fulfillment_verified_dispense` verifies patient, product, quantity and monetary linkage. Derive financial targets here rather than trusting browser-supplied invoice IDs.
- `supabase/migrations/20260913000000_inventory_billing.sql`: immutable credit ledger and `credit_billing_invoice`, including request identity, invoice locking and invoice-wide capacity checks.
- `supabase/migrations/20260913300000_payment_ledger.sql`: refund reservation/evidence/confirmation separation and `prepare_invoice_refund`. Existing collection and reconciliation guards must remain effective.
- `supabase/migrations/20260913330000_payment_reconciliation_observations.sql`: current balances avoid double-counting settled refunds as reservations.
- `src/hub/features/billing/HouseholdInvoices.tsx`: generic credits have no saved reviewed-context guarantee or reload recovery.
- `src/hub/features/payments/InvoicePayments.tsx`: refund review and session recovery exist, but the generic preparation RPC does not atomically enforce the browser's reviewed source hash.
- `src/hub/features/prescriptions/PrescriptionFulfillment.tsx` and `fulfillment-api.ts`: exact dispense identity exists; adjustment history/actions are missing.

The read-only code audit found no dispense-credit/refund attribution table. Generic invoice credits must not be guessed to belong to a medication.

## Chosen design and alternatives

Add immutable attribution and operation receipts around the existing ledgers. This preserves the single balance calculation and provider execution path. A second credit/refund ledger would create competing balances; changing physical return events into financial transactions would incorrectly make custody imply a refund. Both alternatives are rejected.

Use separate reviewed operations for credit creation and refund preparation. The staff interface must show the distinction and permit a credit without attempting a refund. Link refund reservations to a specific native credit; provider-confirmed status continues to come from the existing ledger.

## Implementation phases

### 1. Contract and database

Create an additive migration after the actual current migration head (check concurrent communications work before choosing a filename). Define exact preview, record, read and recovery contracts plus immutable operation/link tables with RLS, authenticated actor attribution, audit identities and revoked raw mutation privileges.

Preview binds the verified dispense/item charge, invoice revision/status, all credits, captured payments, refund states/reservations, reconciliation blockers and reviewed return/correction/discrepancy heads. Hash the complete context server-side. Require a reason and explicit review attestation; derive actor from the session.

Before implementing locks, document the call graph of both existing financial RPCs and native authorization operations. The wrapper must not acquire an invoice lock and subsequently wait on an operation advisory lock held by another path waiting for that invoice. Use one consistent acquisition order, including any nested ledger request ID, and verify it with observed contention tests.

Under the required locks, recheck active staff, exact source relationships and the complete review hash. Reject stale review before mutation. Record the existing credit and its native attribution atomically; changed reuse of an operation ID fails, and an exact retry recovers the original receipt.

Per-dispense linked credits cannot exceed the original item charge; all credits remain subject to existing invoice-wide limits. Conservatively treat unallocated invoice credits as consuming potential item credit capacity instead of silently allocating them. Specify and test the formula in the contract before coding; explain blocked capacity to staff. Explicit reassignment of old generic credits is separate future scope.

Refund preparation must enforce the reviewed context inside the transaction, not only in React. Cap it by both the linked credit's remaining eligible amount and the existing payment/invoice capacity. Specify how failed, pending, uncertain and confirmed provider states affect linked capacity using current ledger semantics. Preserve the provider idempotency key and existing reconciliation guards. Never label reservation as payment completion.

### 2. Strict adapter and staff workflow

Add a focused prescription financial-adjustment adapter and panel beside recorded dispense history. Validate closed response shapes, exact target/actor/context binding and receipt linkage. Keep historical receipt formats unchanged.

Show original charge, prior linked credits, unallocated invoice credits, current capacity and the distinct credit/refund statuses. Keep financial details out of clinical print/release projections. Persist uncertain intent before submission, scoped to staff and exact patient/dispense; recover the saved operation before permitting a replacement request. Refresh sibling invoice/payment views after confirmation without discarding unrelated drafts.

Use the existing provider workflow for later execution; do not activate Stripe or claim a sandbox refund passed. A physical return must never automatically trigger this financial action.

### 3. Acceptance and packaging

- SQL: exact-target tampering, inactive/client denial, stale financial and clinical heads, idempotent recovery, changed-ID reuse, capacity limits, generic-credit interaction and existing checkout/reconciliation blockers.
- Observed concurrency: competing linked credits, generic versus linked credits, competing reservations and authority revocation while waiting; prove no lock-order deadlock.
- Real synthetic Auth: preview/record/recover through the strict adapter, lost-response recovery after reload, immutable receipts and unchanged dispense/item/stock/allowance.
- Browser: explicit review, clear credit versus refund status, blocked/stale review, uncertain-operation recovery and sibling cache updates.
- Restore: populated attribution and operations survive restoration; all ledger and source links verify.
- Existing billing/payment/clinical release regression suites remain passing. No live provider requests are needed for this software phase.

Publish evidence with tested commit, exact counts and limitations in a dependent draft PR. Hosted deployment, provider acceptance and clinical/operational review are separate from synthetic acceptance.

## Remaining decisions to resolve through implementation review

Confirm existing financial-role policy rather than implicitly broadening it; current generic credits allow active staff. Specify currency precision from the billing contract. Prove refund-capacity semantics for failed versus uncertain attempts before exposing retries. Finalize lock order and conservative unallocated-credit arithmetic before mutation code is written.

## Wider roadmap retained

This closes one native medication lifecycle gap. Estimates/client acceptance, client portal and consent workflows, inventory purchasing/transfers, practice reporting and the unassessed ezyVet feature inventory remain in scope. Vet Connect Hub communication parity remains tracked separately in `docs/standalone-feature-matrix-20260916.md`, using Fastmail and Resend. No endpoint inventory alone establishes full feature parity.

## Implementation checkpoint

Migration126 implements attributed credits and separate refund preparation, with exact reviewed context and recovery. The staff panel and strict adapter preserve uncertain requests across reloads and refresh sibling invoice evidence. Actual finance database acceptance is still pending: the first execution caught a PL/pgSQL local-reference error, fixed before a fresh run. See [draft evidence](../../docs/evidence/native-dispense-finance-draft-20260916.json). Do not claim hosted readiness or provider execution from these changes.

Candidate [PR154](https://github.com/finite0001/livingroom-vet-care/pull/154) is stacked on PR151. Final local frontend acceptance passed869 unit tests, app/node TypeScript, lint, build and30 focused browser cases, including4 finance workflows. SQL fixture corrections and full database/concurrency/Auth/restore CI remain pending; the failed local runs were cleaned up.

Recovery review identified a permanent lock after a lost-before-commit request and later invoice change. The follow-up adds serialized server closure, preserving recorded results and permanently rejecting delayed writes for closed IDs. Local frontend acceptance now passes872 unit tests,14 focused finance tests and8 finance browser scenarios. New SQL/contention/actual Auth/restore acceptance remains pending. Existing run35090225400 covers the pre-closure candidate and passed SQL and finance contention steps; it does not prove the new closure behavior.

Final-source acceptance: e8f0c28 passed all CI jobs in35091844016, including101SQLfiles/4169assertions,169finance contention checks,61finance actual Auth checks and103populated restore checks. PR154 remains draft for coordinated stack rollout. The extra local run stopped during runtime discovery after347 inherited checks and cleaned up; no finance/restore pass is inferred from that local attempt.
