# Phase 3 — preventive care, inventory, and billing

Priority: P0 for any October service that dispenses or charges products. Status: not implemented. Depends on phases 1–2 and veterinarian-approved service scope.

## Implementation steps

1. Define the October catalog: services, vaccines, medications, dosage units, price snapshots, billing codes, and whether each requires a certificate or inventory decrement.
2. Add product lots, manufacturer, expiry, locations/mobile kits, receipts, transfers, adjustments, wastage, returns, and an append-only stock ledger.
3. Build one transactional administration/dispense workflow linking patient, encounter, product lot, stock movement, and charge with a unique action key.
4. Extend vaccination records with administration metadata and clinician-set next due dates. Imported/external administrations must not consume local stock or create a duplicate charge.
5. Add practice-configured preventive protocols and patient overrides. Show due, overdue, unknown, suppressed, and completed states; do not hardcode clinical intervals without veterinarian approval.
6. Generate versioned general vaccine and rabies certificates from frozen metadata. Store issued certificates and include them in selected record packages.
7. Add invoice draft/issued/part-paid/paid/void states, line snapshots, discounts/taxes, credits, manual payments, refunds, and payment allocations.
8. Create Stripe Checkout sessions server-side and verify signed webhook events. Reject amount/currency mismatches; deduplicate and reconcile delayed, duplicate, failed, and refunded events.

## Files

- Create: `/Users/davidedler/livingroom-vet-care/src/hub/features/vaccines/`, `/Users/davidedler/livingroom-vet-care/src/hub/features/inventory/`, `/Users/davidedler/livingroom-vet-care/src/hub/features/billing/`.
- Create: `/Users/davidedler/livingroom-vet-care/supabase/functions/generate-certificate/index.ts`, `create-checkout/index.ts`, and `stripe-webhook/index.ts`.
- Add: versioned migrations, transactional RPCs, generated types, SQL tests, and browser tests.

## Success criteria

- One vaccine administration produces one clinical record, one stock decrement, one charge, and one due event.
- Expired/insufficient lots are blocked; retries do not duplicate stock or charges.
- Stripe sandbox payment and webhook replay update the invoice once.
- Certificates match veterinarian-approved samples and retain their issued history.
