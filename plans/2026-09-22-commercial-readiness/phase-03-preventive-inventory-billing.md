# Phase 3 — preventive care, inventory, and billing

Priority: P0 for any October service that dispenses or charges products. Status: implemented foundation with evidence gaps; integrated hosted/staff acceptance remains open. Depends on phases 1–2, veterinarian-approved service scope, and the remaining-readiness plan.

## Current implementation inventory

Do not treat this phase as an empty build. Current repo surfaces include:

- Hub features: `src/hub/features/inventory/`, `src/hub/features/care-charts/`, `src/hub/features/care-reminders/`, `src/hub/features/certificates/`, `src/hub/features/billing/`, and `src/hub/features/payments/`.
- Database migrations: `20260913000000_inventory_billing.sql`, `20260913030000_inventory_read_models.sql`, `20260913060000_care_charts.sql`, `20260913080000_vaccine_certificates.sql`, `20260913140000_care_reminders.sql`, `20260913150000_invoice_documents.sql`, `20260913190000_certificate_due_plans.sql`, `20260913300000_payment_ledger.sql`, `20260913310000_stripe_event_inbox.sql`, `20260913340000_payment_collection_access.sql`, and related payment reconciliation/delivery migrations.
- Edge functions: `invoice-checkout`, `invoice-refund`, `stripe-webhook`, `process-stripe-events`, and `prepare-payment-delivery`.
- Test coverage: inventory, care charts/reminders, certificates, invoice documents, payment ledger/access/reconciliation, Stripe event, and payment delivery suites exist under `supabase/tests/` and `tests/`.

The next step is an integrated synthetic proof and reviewer acceptance, not a fresh feature build.

## Implementation steps

1. Confirm the October catalog: services, vaccines, medications, dosage units, price snapshots, billing codes, and whether each requires a certificate or inventory decrement.
2. Replay and run the existing inventory/billing/payment/certificate test suites on a clean current stack.
3. Prove one transactional administration/dispense workflow linking patient, encounter, product lot, stock movement, invoice line, and unique action key.
4. Verify vaccination administration metadata, next-due decisions, and imported/external vaccination separation.
5. Verify practice-configured preventive protocols and patient overrides. Show due, overdue, unknown, suppressed, and completed states; do not hardcode clinical intervals without veterinarian approval.
6. Verify versioned general vaccine and rabies certificate issuance from frozen metadata. Store issued certificates and include them in selected record packages.
7. Verify invoice draft/issued/part-paid/paid/void states, line snapshots, discounts/taxes, credits, manual payments, refunds, and payment allocations.
8. Verify Stripe Checkout sessions server-side and signed webhook handling. Reject amount/currency mismatches; deduplicate and reconcile delayed, duplicate, failed, and refunded events.

## Files

- Verify/modify: `/Users/davidedler/livingroom-vet-care/src/hub/features/inventory/`, `/Users/davidedler/livingroom-vet-care/src/hub/features/care-charts/`, `/Users/davidedler/livingroom-vet-care/src/hub/features/care-reminders/`, `/Users/davidedler/livingroom-vet-care/src/hub/features/certificates/`, `/Users/davidedler/livingroom-vet-care/src/hub/features/billing/`, and `/Users/davidedler/livingroom-vet-care/src/hub/features/payments/`.
- Verify/modify: `/Users/davidedler/livingroom-vet-care/supabase/functions/invoice-checkout/index.ts`, `invoice-refund/index.ts`, `stripe-webhook/index.ts`, `process-stripe-events/index.ts`, and `prepare-payment-delivery/index.ts`.
- Add only missing narrow migrations/tests discovered by the integrated proof.

## Success criteria

- One vaccine administration produces one clinical record, one stock decrement, one charge, and one due event.
- Expired/insufficient lots are blocked; retries do not duplicate stock or charges.
- Stripe sandbox payment and webhook replay update the invoice once.
- Certificates match veterinarian-approved samples and retain their issued history.
- Existing local foundation is proven as one integrated workflow before any hosted/live provider claim.
