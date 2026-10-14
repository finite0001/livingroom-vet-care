# Phase 1 — Client integrity, patient photo and Whogot

**Status:** 1A merged in [PR #230](https://github.com/finite0001/livingroom-vet-care/pull/230), deployed to staging/primary and verified with hosted probes and owner-session UI checks. [Rollout receipt: merged PR #231](https://github.com/finite0001/livingroom-vet-care/pull/231). Both databases have zero incomplete contacts and validated constraints. 1B has a tested engineering implementation in [PR #232](https://github.com/finite0001/livingroom-vet-care/pull/232); PR #232 is merged and photos are deployed to staging/primary; hosted verification passed and practice acceptance remains pending. 1C (Whogot) is implemented and locally verified in [PR #234](https://github.com/finite0001/livingroom-vet-care/pull/234); PR #234 is merged and deployed to staging/primary; hosted engineering verification passed. Practice acceptance remains pending. [Hosted rollout evidence](../../docs/launch-evidence/2026-10-10-whogot-rollout.md). **Priority:** high. **Requirements:** N03–N05, N09, N17; H01, H04, H20. **Depends on:** Phase 0 contact audit. [Decisions](decisions.md).

## Implementation packages

### 1A — Required contact details and linked creation

- Put required/valid phone and email rules in the shared client form and the server write boundary. Normalize phone for the existing SMS workflow; use the existing email validation conventions. Contact details alone never grant messaging consent.
- Audit every actual client-writing path, including inquiry conversion, staff create/edit and retained import promotion paths. Disable or update any path that bypasses the same rule. Keep public inquiries as inquiries until complete; do not create incomplete clients automatically.
- Keep create client → create patient sequencing. Patient creation requires a real existing client with complete contacts; use the existing restrictive FK and authenticated actor checks. A failed second step must not duplicate the saved client on retry.
- Migration sequence: add audited validation for new writes, identify and correct legacy missing contacts, then validate persisted constraints. For an incomplete legacy record, require both real values when saving a client edit. Do not retroactively alter valid clinical entries or hide their charts.

### 1B — Patient identity photo

Implementation: [PR #232](https://github.com/finite0001/livingroom-vet-care/pull/232) at `0d98918042d32361042634732d2775df02f4ac41`. Private normalized PNG images, server pixel/hash/object verification, versioned current-photo selection, retained removal history and actor/patient-scoped retry recovery are implemented. Local checks: 1,274 unit tests and 5,437 database assertions passed; genuine local Auth/Storage and observed races passed. All CI jobs passed; hosted staging/primary rollout and engineering verification are complete. Practice acceptance remains pending. [Evidence](../../docs/launch-evidence/2026-10-09-patient-photos.md).

- Reuse private patient-document upload/validation; store a patient-scoped current photo reference. Show upload/change/remove on the Patient 360 header and a compact image in search where useful.
- Verify ownership, image MIME/bytes, size and usable orientation. Use short-lived authorized image access; no public bucket. Remove changes the current reference, respecting document history/retention.
- Do not automatically add the photo to clinical releases or AI input. Photo presence is optional and must not block chart access.

### 1C — Whogot

- Add a clearly labeled **Whogot** button on Patients and a reusable entry from Inventory. Search filters: product/vaccine/service, administered vs dispensed vs performed, date range, lot, species and clinician. Product selection uses stable IDs and mapped aliases, not free-text equality alone.
- Add a staff-only paginated query combining completed `patient_treatments`, completed `native_dispenses` and new performed-service events. Expose original source and correction status. Prescribed-but-not-dispensed and billed-only items do not qualify by default.
- Add an explicit performed-service record with patient, encounter, service ID/snapshot, performing clinician, completion time and correction history. Link optional billing; never derive performance from charge creation. Make service completion easy within the existing clinical encounter.
- Results show patient, client/contact, date, product/lot/service, event type and source-record link. Historical imported evidence can be a separately labeled source; absence of data is not proof a treatment was never given.
- Use server filters, indexed product/date/patient/lot keys and deterministic pagination. CSV export uses the same scope and permissions. No automatic outreach from search results.

## Files and schema

| Action | Absolute path | Change |
|---|---|---|
| Modify | `/Users/davidedler/Developer/lrv-feedback-plan-20261008/src/hub/components/clients/client-form.ts` | Shared required contact validation |
| Modify | `/Users/davidedler/Developer/lrv-feedback-plan-20261008/src/hub/components/clients/ClientFormFields.tsx` | Field errors and required labels |
| Modify | `/Users/davidedler/Developer/lrv-feedback-plan-20261008/src/hub/features/patients/PatientFormDialog.tsx` | Complete-client precondition and recoverable save |
| Modify | `/Users/davidedler/Developer/lrv-feedback-plan-20261008/src/hub/features/patient-360/` | Photo/header and history integration; resolve exact components at execution |
| Modify | `/Users/davidedler/Developer/lrv-feedback-plan-20261008/src/hub/features/clinical/ClinicalWorkspace.tsx` | Performed-service entry/link |
| Create | `/Users/davidedler/Developer/lrv-feedback-plan-20261008/src/hub/features/whogot/` | Search UI, query contract and CSV export |
| Create | `/Users/davidedler/Developer/lrv-feedback-plan-20261008/supabase/migrations/<next>_client_integrity_and_whogot.sql` | Additive validation/photo/service/search RPC changes; timestamp assigned at execution |

Update existing client-writing migrations through a **new** migration; do not edit applied migrations. New paths are proposed. No existing files are scheduled for deletion.

## Acceptance

- [ ] Missing either contact is rejected through UI and direct RPC; valid contacts survive reload. No override exists.
- [ ] Two pets share one client correctly; wrong-client linkage and unauthenticated writes fail.
- [ ] Photo access is authorized; unsupported files fail cleanly and leave the prior photo intact.
- [ ] Whogot returns correct patients across products/lots/dates; never counts a prescription, voided administration or invoice-only service as current treatment.
- [ ] Completed service entry appears once after retry; correction remains traceable; pagination has no missing/duplicate events.
- [ ] Add meaningful cases to `e2e/patients.spec.ts`, clinical SQL tests and new Whogot SQL/query/browser tests. Reuse existing alert tests to ensure critical reactions stay visible.

**Risks:** incorrect legacy-contact backfill, ambiguity between administration and dispensing, and product aliases. Resolve with actual contact cleanup and explicit event/source labels. Whogot query returns only data authorized for active staff; server identity stamps every new clinical event.

Hosted rollout: merge `7cf7fbf`, both backends at 169 migrations, verifier version 1 with JWT checks, production READY. Hosted staging upload/change/remove passed; both backends passed 29 rolled-back SQL checks; primary records were unchanged. [Rollout receipt](../../docs/launch-evidence/2026-10-09-patient-photo-rollout.md). Whogot is implemented in [PR #234](https://github.com/finite0001/livingroom-vet-care/pull/234); hosted rollout remains pending.

The reproducible hosted receipt and synthetic screenshot are in [documentation PR #233](https://github.com/finite0001/livingroom-vet-care/pull/233), awaiting its own review/merge. The application/backend rollout is already complete.

Whogot implementation head: `4f8993ca67e361960a432f44d3bcce66fd95d0ba`. Local verification: 1,278 unit tests, 5,500 SQL assertions across 135 files (63 Whogot checks), 16 actual Auth/PostgREST checks and five observed service races passed. Final six targeted browser scenarios passed with normal committed timeouts. [Implementation and rollout instructions](../../docs/launch-evidence/2026-10-09-whogot.md). Service records are visible in the patient chart; inclusion in client-release bundles remains phase 4 work. Imported records are not silently included in Whogot.
