# Package 3A1 — native in-house diagnostics

Baseline: `3bd3f002b78b65d1eed6cccf711d355aa67ba3c4` (merged PR #237). The parent phase-3 plan and PDF feasibility evidence are in [PR #238](https://github.com/finite0001/livingroom-vet-care/pull/238), whose CI passed and which remains unmerged pending Dave's specific approval.

## Package boundary

This package implements manual numeric/qualitative panels, active named-DVM finalization, append-only corrections, immutable reviewed attribution, source-version linkage and compatible trend charts. The parent 3A package is divided into **3A1 native clinical workflow** and **3A2 reviewed release integration** so the latter can bind real generated PDFs from 3B. This does not reduce the 45-feature launch requirement.

No generated diagnostic PDF exists in this package. The clinical record remains saved, while its UI shows PDF unavailable and complete record-request manifests explicitly disclose diagnostics as exclusions. This prevents a new native clinical family from silently disappearing from a purported complete export. Release schema14, durable PDF jobs/private Storage capture/recovery, exact PDF review, certificate/selected-record PDFs and frozen transport remain required in 3A2/3B/3C. Neither practice acceptance nor commissioning is inferred.

## Completed design

- Four private RLS ledgers with no direct anon/authenticated/service-role read/write grants. Six active-staff RPCs; private helpers stay inaccessible. Patient identity cannot be reassigned or deleted through the workflow.
- Strict exact-key validation, bounded arrays/text/bytes, valid chronological calendar dates and optional same-patient order/encounter/original with exact reviewed version. Numeric zero is retained; blank is not zero. Unsupported numeric underflow fails visibly rather than rounding a nonzero finding to zero. No reference intervals, flags, unit conversions or diagnoses are inferred.
- Staff can draft. Only an active **named DVM** can finalize/correct. Exact saved values, expected root version, explicit review note and correction reason bind finalization. Operation IDs and original immutable receipts resolve lost responses; changed retries and stale writers cannot overwrite another record.
- Immutable finalized versions retain predecessor, reviewer/enterer IDs and **names at the relevant save/review**, source metadata, review/correction notes, timestamp and a hash binding identity plus reviewed content. Later profile edits do not rewrite historical attribution.
- Original-file historical linkage stays distinct from current availability. DVM UI downloads and rechecks the exact linked private original before attestation; later voiding retains reviewed evidence and marks the original unavailable. This does not claim a provider-origin byte attestation or automatically change the linked native order's status/reminders.
- Trend grouping requires exact patient/analyte/specimen/method/device/source/unit/type. Text findings are dated events. Current finalized versions are paged with a census fingerprint captured in the same SQL snapshot; a correction during paging requires a complete reload. Corrected predecessor values stay in explicit history, not alongside the new head as extra current points. Every plotted value links to its reviewed panel/version and its own reference context.
- Patient 360's existing medical/lab section opens diagnostics on demand and retains the view preference per actor/patient. The module is lazy loaded. Native order/provenance and diagnostic editors share one navigation dirty signal and peer-editor exclusion. Session-bound uncertain intents survive remounts and are never inherited by another actor/patient.
- Source pickers page through older choices and keep an already selected source/version visible outside the current page. Partial numeric text stays editable and blocks saving a previously valid number. Values/review changes reset attestation.

## Verification and rollout

See the [implementation receipt](../../docs/launch-evidence/2026-10-11-manual-diagnostics-implementation.md). Local proof includes a clean 174-migration replay, full SQL/unit regression, seven browser scenarios, observed lock waits and genuine Auth/private Storage/real Patient 360. All synthetic data lives in owned disposable local runtimes; no provider requests or hosted writes.

Before rollout: exact-head frontend/edge/database CI must pass, Dave must explicitly approve this PR, and migration174 must be verified on staging then primary before the corresponding frontend is promoted. No Edge source/consumer changed in 3A1. Preserve all existing release, disclosure, financial, provider and scheduler settings. Keep schema13 and its existing accepted-policy state intact until separately reviewed release/PDF integration is ready.

## Files

The implementation worktree is `/Users/davidedler/Developer/lrv-manual-diagnostics-20261011`.

- Create `supabase/migrations/20261011181722_manual_diagnostic_panels.sql`: native ledgers/RPCs and complete-export exclusion wrapper.
- Create `src/hub/features/diagnostics/`: typed models/APIs, patient editor, source links, history, numeric inputs and trends.
- Modify `src/hub/features/patients/PatientPage.tsx`: lazy medical/lab workspace and existing dirty guard.
- Create `supabase/tests/manual_diagnostics{.test.sql,_concurrency.py}`, `tests/diagnostics/` and `e2e/manual-diagnostics.spec.ts`: clinical permissions/version/receipt/source/paging/actual-byte/presentation proof.
- Modify `.github/workflows/ci.yml`: real contention and uniquely owned Auth/private-file/Patient 360 acceptance.
- Deliberately update the three migration inventory tripwires to174. Do not regenerate Lovable-managed `types.ts`.
