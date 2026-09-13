# Phase 3b — Reviewed outside vaccination history

Status: ready for implementation planning review; not implemented. Base: PR109 / `codex/vaccination-intake` commit22bdbf3. This is the next clinical increment after [consult-scoped intake](phase-03a-vaccination-intake.md). Living Room Vet remains primary; source access is read-only.

## Outcome and boundaries

A clinician reviews an imported vaccination, records an explicit interpretation of its date/status and optional local vaccine-product match, and saves it once to the patient chart as outside vaccination history. Original source values and exact vaccination/consult revisions remain inspectable. Unknown dose, route, lot, manufacturer and outside clinician identity remain unknown. A reviewed record does not assert local administration or certificate eligibility.

This phase must include patient-chart visibility and source-aware record release support, not only an import review screen. Adoption into an active due plan is a separate follow-up operation, with its own source linkage and clinician decision. Do not activate reminders, stock movements, billing, native treatment administration or certificates during approval.

## Existing constraints and chosen design

`record_patient_treatment` in migration0000 requires quantity, timestamp, dose, route and veterinarian even for historical entry; that branch leaves product_id null. Filling these requirements from incomplete source data would invent information. `save_patient_vaccine_due_plan` in migration1400 requires a product-matched treatment when a treatment anchor is selected. Neither is a suitable implicit import destination.

Use a dedicated immutable outside-vaccination representation. Per-record product selection is an explicitly reviewed interpretation, not a global ezyVet product mapping. Global catalog mapping needs a verified source-product contract and remains subsequent work. Existing catalog product/version and vaccine kind must be validated; source product reference stays independent. Local catalog selection must never populate historical manufacturer, lot, dose or route. Do not select a product automatically from descriptions.

Reuse migration5000's prepare/approve/recover/abandon pattern, not ordinary null-ID create calls. Reuse migration5200's exact scoped observation chain. Retain immutable review requests and approved records behind RLS with direct API-role access revoked. Public RPCs validate auth.uid(), active role and exact patient/context themselves.

## Roles and frozen request

Intake remains ADMIN-only. Add a narrow DVM-readable candidate projection for mapped patients, exposing the same evidence validation without allowing DVMs to trigger imports. Clinical interpretation and final approval require active DVM. Do not relax existing ADMIN intake RPCs or assume the current all-staff due-plan permissions constitute clinician approval.

A browser-generated operation UUID is saved before prepare. Freeze actor, patient/client/mapping, source origin/site, vaccination snapshot/hash/observed head revision, and the exact consulted vaccination receipt association: consult snapshot/hash/observed revision. Freeze selected local product ID/version when present, reviewed date values and precision, status interpretation, outside-author text and review rationale. Payload fields have explicit schema, bounds and null semantics.

Date-only source evidence must stay a date, without an invented midnight/time zone. Store reviewed administration date and reviewed source next-date separately; both nullable with explicit unknown/uninterpreted status. Raw strings remain available. Do not infer epoch units or normalize unknown active values into administered status. Numeric source qty remains raw unless an independently reviewed unit is supplied; this phase need not interpret dose.

Prepare locks and validates current vaccination/consult evidence, patient membership and catalog version. Approval validates frozen identity before handling an already-completed operation, then revalidates all mutable dependencies for a new commit. Terminal exact recovery returns the same receipt after source changes. One source vaccination identity must not create duplicate active outside-history entries through multiple UUIDs; use one latest approved version per (source origin, site, animal mapping, vaccination external ID). Identical reapproval returns the existing approved version; changed interpretation requires replaces_id, expected predecessor hash and rationale. Serialize this identity and enforce one successor per predecessor; never upsert approved evidence. A changed source does not rewrite approved history.

Provide actor-owned durable request discovery after browser pointer loss, plus recover and explicit abandon. Request identity never silently rebinds. Do not keep indefinite browser-only operations as the only recovery mechanism.

## Database and UI implementation

1. Create additive migration via CLI; reserve next canonical version after confirming concurrent migration inventory. Add `ezyvet_vaccination_review_requests`, `ezyvet_imported_vaccinations` and immutable correction/source links. Include versioned reviewed values and catalog snapshot for later disclosure.
2. Add narrow candidate, prepare, approve, recover, list-requests, abandon and chart-read RPCs. Use consistent advisory/source-head lock order, compatible patient reads and explicit final stale checks. Exact names/signatures go into a frozen contract before parallel implementation.
3. Create `src/hub/features/imports/VaccinationHistoryReview.tsx` and its runtime-validated API/hook beside the imported-history review components. Original and reviewed values must remain visibly distinct. Handle stale context, changed catalog, wrong actor, missing clinical values, correction conflicts and uncertain responses.
4. Integrate one dirty-state callback into the existing shared import-page blocker. Preserve frozen UUID through navigation, clear actor pointers on signout/account change, and ignore late responses after patient changes.
5. Add an outside-vaccination section to the patient chart. All active staff may read authorized chart history; only DVMs interpret/correct it. Display reviewer, review date, outside attribution, explicit unknowns and current source discrepancy. Do not present approval as a new administration.
6. Extend record-release selection, preview, immutable snapshot and source revision checks with a new version after schema6. Add `imported_vaccination` as a distinct source kind. Preserve schemas1–6 rendering/recovery. Schema7 must compose schema6 imported-history validation/rendering: its existing helpers currently return early unless schema_version equals6. Add mixed narrative/vaccination fixtures so neither lineage disappears. Include raw/interpretation provenance and correction history consistently in print, email and SMS-linked artifacts. A changed source or reviewed supersession must follow the existing re-review rules; omission cannot launder a native clinical assertion.
7. Update clinical review cases for Dr. Susan Edler and deployment inventory. Keep hosted clinical release policy disabled until explicitly reviewed.

## Owned file areas

Repository root for these paths: `/Users/davidedler/livingroom-vet-vaccination-commissioning`; implementation uses isolated worktrees based on the tested stack.

- New migration(s), `supabase/tests/ezyvet_vaccination_review.test.sql` and observed-lock runner: database owner.
- New review API/hook/component under `src/hub/features/imports/`, patient chart panel and shared navigation callback: UI owner. Coordinate modifications to `EzyVetImportPage.tsx` with root.
- Record release projection/version validators/renderers under the existing release feature and shared Edge rendering modules: release owner; freeze database contract first.
- Actual disposable Auth/HTTP tests, browser tests, restore receipt fixture, CI and docs: root/runtime owner.
- Read and reuse existing `SourceHistoryApproval.tsx`, `useHistoryOperation.ts`, `PatientVaccineDuePlans.tsx`, migration5000 and migration5100. Do not edit historical migrations.

## Required evidence

- Identity: wrong actor/role/site/patient/household, generic-only source, wrong snapshot/hash/revision and changed catalog version denied independently in SQL.
- Staleness: vaccination and consult A→B→A; source updates racing prepare/approve in both observed lock orders; immutable historic approvals retained and discrepancy shown.
- Recovery: retained UUID with altered payload/hash, approval after abandonment, duplicate approval across clinicians, revoked role, patient reassignment, late browser responses, lost prepare/approval response, pointer loss, duplicate UUID and multiple UUIDs targeting the same source; exact terminal recovery after changed eligibility; confirmed abandonment.
- Clinical data: absent/null/ambiguous date, unknown/inactive source status, missing product and missing dose/route preserved without fabricated defaults. Reviewed dates do not appear as active due plans.
- Side effects: unchanged treatment, inventory, invoice, certificate, reminder and outbox counts.
- Disclosure: new-version print/email/link payloads match reviewed content; older release schemas retain exact behavior; raw strings escaped and unreleased histories omitted. Vaccination/consult head changes and reviewed supersession invalidate pending affected releases; issued artifacts remain immutable.
- Actual local Auth/HTTP, meaningful targeted browser coverage, prior intake/history regressions and complete upgrade/restore of approval and source lineage. Separate synthetic evidence from authorized practice-sample acceptance.

## Follow-up: explicit due-plan adoption

Once outside history is reviewed, a separate DVM operation may adopt its interpreted dates through the existing due-plan validator with a durable source-history link and expected plan/template/product versions. It must require explicit interval/due-date reasoning, preserve any existing plan on conflict and default reminders off. Historical treatment creation is not a prerequisite. This follow-up is required for the full vaccination/due-date migration goal and is not completed by Phase3b.

## Open dependencies

Authorized vaccination sample/date semantics and Dr. Edler's clinical review remain pending. Global source-product mappings, supported full-source export/cutover semantics and live reminder commissioning remain separate. These do not block synthetic implementation; no additional API fee or write-back is required for this design.

## Frozen RPC names and concrete disclosure files

Use `list_ezyvet_vaccination_review_candidates`, `prepare_ezyvet_vaccination_review`, `approve_ezyvet_vaccination_review`, `recover_ezyvet_vaccination_review`, `list_ezyvet_vaccination_review_requests`, `abandon_ezyvet_vaccination_review` and `list_patient_imported_vaccinations`. Prepare takes operation UUID, patient UUID and validated payload; approval takes operation UUID, patient UUID, expected prepared hash and explicit confirmation. Recovery/abandon enforce original actor and current active role even after terminal completion. SQL derives source identity from pinned snapshots and receipts; browser data cannot override it.

Chart integration: `src/hub/features/patients/PatientPage.tsx`, alongside `PatientImportedHistory.tsx`. Release integration: `src/hub/features/record-releases/{api.ts,selection.ts,refresh.ts,PatientRecordReleases.tsx,RecordReleaseArtifact.tsx,print.ts}` and `supabase/functions/_shared/{record-release-imported-history.ts,record-release-source-provenance.ts,record-release-renderer.ts}`, plus a dedicated vaccination module. Independent read-only plan review confirmed these paths and the historical treatment/due-plan constraints.
