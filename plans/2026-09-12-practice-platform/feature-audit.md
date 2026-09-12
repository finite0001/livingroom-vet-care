# Feature coverage and current evidence

Static review of livingroom-vet-care at `77e08d1`, 2026-09-12. “Partial” means code or schema exists, not a verified live capability. No production account, deployed schema, provider secret or actual patient record was accessed.

Primary evidence: `src/App.tsx`, `src/hub/pages/ClientProfilePage.tsx`, `src/hub/hooks/use-client.ts`, `src/integrations/supabase/types.ts`, all checked-in migrations, and the four functions under `supabase/functions/`.

| Requested feature | Current state | Required implementation and acceptance | Phase |
|---|---|---|---|
| Client name/address/phone/email | Partial: name, phone, email; no structured address in client schema | Add mailing and visit addresses, contact edit workflow and duplicate review; save/reload all fields | 2 |
| Pet name/age/species/breed/weight/birthday/color/microchip | Partial: most fields in `pets`; basic read-only profile summary; color absent | Full patient editor, color, approximate DOB support, derived age, weight history with units | 2 |
| Vaccine last administered and upcoming due dates | Schema only: `pet_vaccinations` | Patient vaccine history and due list backed by actual administrations and clinician overrides | 4 |
| SOAP clinical records | Not found | Draft/save/sign/addendum workflow and encounter history | 2 |
| Historical diagnoses and red important warnings | Not found as structured clinical workflow; pet allergies are free text | Longitudinal problem list and reaction/allergy alerts; persistent red semantic token plus text/icon | 2 |
| Text/email clients with records and labs | Partial: outbound Twilio/Resend calls; local attachment storage | Client send endpoint must accept authorized attachments; verify delivery and inbound replies | 3 |
| Standard and patient-custom vaccine/lab reminders | Partial tables; no complete scheduled delivery worker | Versioned protocols, patient overrides, due events, cancellations, suppression and retries | 3–4 |
| Vaccine certificates with all due dates | Not found | Frozen PDF summary of vaccine history/current due dates, unknown/overdue states explicit | 4 |
| Rabies certificate with all vaccine information | Not found | Vet-approved separate signed template populated from administration/product/lot snapshots | 4 |
| Create/send invoices for payment by text/email | `payment_links` table; no invoice ledger/workflow | Itemized invoice, payment link, webhook reconciliation, refunds/voids and delivery | 4 |
| Select some/all medical records and email | Partial file browsing; no record-package generator | Patient/date/category selection, preview, exclusion of internal notes, authorized attachments/link | 3–4 |
| Medication inventory, expiry/lot and billing | Refill workflow only; no stock ledger | Products, locations, lots, expiry, dispensing, wastage, returns and linked charge | 4 |
| Vaccine inventory/information and billing | Lot text on vaccination; no inventory system | Vaccine catalog, inventory lots, administration-stock-charge transaction | 4 |
| Schedule with optional Google Maps | Appointment schema; no schedule route; public address map link exists | Day/week schedule, staff/room/travel conflicts; navigation links then optional routing | 3 |
| Automatic appointment reminders | `appointment_reminders` schema | Scheduled worker sends once; rescheduling/canceling invalidates old reminders | 3 |
| Dental charting in patient record | Not found | Species/dentition-aware tooth chart with findings, treatment and dated revisions | 5 |
| Automatic anesthesia records in patient record | Not found | Identify vendor/API/export; reliable patient/encounter-matched import with provenance | 5 |
| QOL charting | Not found | Vet-approved versioned questionnaire, responses and trends; no autonomous decisions | 5 |
| Reopen/update body maps for masses | Not found | Stable lesion IDs, normalized coordinates, serial measurements/photos and history | 5 |
| Unified inbox | Partial: channels, assignment, priority, notes, threads | Real inbound adapters, per-user read state, search, patient links and delivery states | 3 |
| New visuals and logo | Website imagery/styles exist; new identity needed | Approved logo kit, design tokens, real practice content and responsive public/staff layouts | 6 |
| Lovable/GitHub → Supabase/Vercel | Supabase client/migrations already present; ownership unverified | Inventory backend ownership; migrate if necessary and prove restoration/deployment | 1, 6 |
| External veterinary-software API data | Living Room ezyVet route is a placeholder; reference hub has ezyVet sync/proxy | Preserve API capability with staged import/read views, provenance, authorization and conflict handling | Discovery 1; housecall subset before pilot; full scope 5 |

## Findings that change sequencing

- Existing July commercial-readiness report is historical. Current `send-sms/index.ts` calls Twilio; its old “SMS stub” finding is superseded. Do not carry forward its issue counts as current.
- Both `send-sms` and `send-email` mark `delivered = true` after a successful provider API response. That means provider acceptance, not confirmed delivery. `SendToClientDialog.tsx` can display “SMS delivered” prematurely.
- No inbound email/SMS or delivery callback function is checked in. `send-email` sends text without attachments; storing a file beside a message does not deliver it to the recipient.
- `send-provider-email/index.ts` supports provider attachments but references `provider_contacts` and `provider_deliveries`, which were not found in checked-in migrations or generated types. Resolve schema drift before treating that path as usable.
- `App.tsx` has no clinical, invoice, inventory or calendar pages; `/hub/tools/ezyvet` is a placeholder. Build this as the clinical source of truth rather than assuming an external ezyVet system supplies everything.
- Password recovery still points to `/hub/login` without a reset route. Staff onboarding remains console-oriented. Resolve both before migrating real staff accounts.
- Correct Spruce Street address is already present. Public pages still contain fictional 555 phone/emergency numbers. Verify staff biographies, images, credentials, service claims and directions before publication.
- Existing RLS has later hardening migrations. Review effective policies after a clean replay; do not judge the final policy state from the permissive original migration alone.
- Existing client/pet cascade deletes conflict with durable clinical history once records are added. Replace destructive deletion with archive/merge workflows for clinical entities.

## Verification scope

Dependency installation used `npm ci --ignore-scripts`. Build, explicit TypeScript check and lint were run as baseline checks; results are recorded in `baseline-checks.md`. No live delivery, clinical correctness, production RLS or deployed migration parity is claimed.
