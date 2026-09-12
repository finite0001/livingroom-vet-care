# Phase 4 — preventive care, stock, certificates and Stripe

Priority: P0 for services offered in October. Status: planned. Depends on: phase 2; delivery uses phase 3.

## Requirements and design

One recorded administration/dispense event links patient, visit, product lot, stock change and charge. Keep vaccine due dates and certificate history independently auditable. Use Stripe as the initial processor based on owner preference; the local invoice is the business ledger and Stripe supplies hosted payment collection and payment events.

## Implementation checklist

1. [ ] Catalog medications, vaccines and services, including units, dose presentation, sale price and billing codes. Lots carry manufacturer, lot number, expiry and on-hand quantities by clinic/mobile-kit location. Add stock receipts, transfers, adjustments, wastage and returns.
2. [ ] Build administration/dispense workflow with expiry/available-stock checks, relevant clinical alerts and atomic stock/charge creation. Inventory expiry and next vaccine due date are separate concepts.
3. [ ] Extend vaccination records with product/manufacturer/lot expiry, dose, route/site, administrator, source and clinician-set next due date. Preserve historical external administrations without decrementing local inventory or billing them again.
4. [ ] Add preventive protocols and patient overrides. No hardcoded clinical interval assumptions: veterinarian configures defaults and validates reminder calculations. Display upcoming/overdue/unknown status and prior doses.
5. [ ] Generate general vaccine certificate including all recorded vaccine due dates and a separate rabies certificate. Candidate rabies fields: certificate/tag ID, practice and veterinarian/license/signature, client/address, patient identifiers including color/microchip, administration date, product/manufacturer, lot/serial, dose/route, validity and next due date. Veterinarian checks the exact current Colorado/Boulder template requirements before release; this list is not a legal certification.
6. [ ] Snapshot and version PDFs; preview, save to patient record, download and include in selectable record packages. Revised patient or product data must not silently alter an issued certificate.
7. [ ] Add draft/issued/part-paid/paid/void invoice lifecycle, service/product lines, discounts, appropriate configured taxes, deposits/credits and payment allocations. Store integer currency amounts. Create Stripe Checkout session server-side against an issued invoice; share URL by existing email/SMS flow.
8. [ ] Verify signed Stripe events; reconcile success/failure/refund without trusting return-page navigation. Deduplicate payments, reject invoice/amount/currency mismatch and handle duplicate/out-of-order events. Record cash/manual payments separately if needed. Evaluate Stripe Terminal later for clinic card-present checkout.

## File work

- Create `/Users/davidedler/livingroom-vet-care/src/hub/features/vaccines/`, `/Users/davidedler/livingroom-vet-care/src/hub/features/inventory/`, `/Users/davidedler/livingroom-vet-care/src/hub/features/billing/`.
- Create `/Users/davidedler/livingroom-vet-care/supabase/functions/generate-certificate/index.ts`, `/Users/davidedler/livingroom-vet-care/supabase/functions/create-checkout/index.ts`, `/Users/davidedler/livingroom-vet-care/supabase/functions/stripe-webhook/index.ts`.
- Add transactional RPCs and tables through `/Users/davidedler/livingroom-vet-care/supabase/migrations/`, regenerate types; modify patient routes and document selection UI. No planned deletions.

## Acceptance and risks

Give one vaccine from a mobile-kit lot: one stock decrement, one charge, correct historical administration, two appropriate document options and a next-care due event. Replay the operation with no duplicate charge/stock movement. Block expired/insufficient stock. Import an outside vaccination without consuming inventory. Refund or void leaves attributable financial/clinical history. Stripe sandbox payment and webhook replay update invoice once, including delayed payment/failure. Vet signs off on sample certificates. Launch service list determines which dispensing/certificate workflows are mandatory in October.
