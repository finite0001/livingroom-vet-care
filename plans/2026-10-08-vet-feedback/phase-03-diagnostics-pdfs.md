# Phase 3 — Structured diagnostics, trends and reliable PDFs

**Status:** Manual diagnostics (3A1/#239) and durable PDF recovery (3B1/#240) are merged, deployed and engineering-verified. Both hosted backends now have179 migrations. The isolated renderer/admission package 3B2A is implemented in [PR #241](https://github.com/finite0001/livingroom-vet-care/pull/241); all exact-head CI passed; #241 is approved, merged and production READY. Private Storage artifact registration (3B2B/#242) is merged and rolled out. Staff PDF review/download (3C/#243) is approved, merged and rolled out default-off; 3A2a sharing-scope preview is merged/rolled out and3A2b/#245 integrated export is approved, merged and rolled out default-off. All 45 launch requirements and practice acceptance remain required. **Priority:** high. **Requirements:** N14–N16, N22; H05, H07–H08, H10. **Depends on:** current lab provenance/release foundation; Phase 2 for request-queue linkage.

## Implementation packages

1. Add diagnostic panels and observations under the existing patient lab order/result model. Store analyte identity, original label, numeric or qualitative value, unit, reference bounds/text, source flag, specimen/collection time, report time, source/device, author/reviewer and correction version. A zero is not a missing value; qualitative findings remain text.
2. Add an **In-house result** editor with manual entry, draft save, review/finalize and append-only correction. Preserve original report uploads and link extracted/transcribed values to their source. A later provider adapter writes through the same staged review contract.
3. Add longitudinal charts for compatible analyte/specimen/unit series, with points linked to source result and reference-range context. Preserve original units. Do not silently combine methods/specimens or convert units without an explicit reviewed mapping. Show text-only results as events, not fake numeric values.
4. Implement server-owned PDF generation from an immutable reviewed report snapshot. Use a dedicated renderer/worker appropriate to the hosting runtime; prove a single representative long report before selecting the engine. Do not assume the existing Supabase Edge runtime can run a browser renderer.
5. Store a versioned PDF in private Storage with content hash, source versions, creation status and renderer version. A finalized result may show **PDF preparing/failed** until it is ready; sharing as a PDF is unavailable until verified. Recovery must be idempotent and preserve the finalized clinical record if rendering fails.
6. Extend release preparation to include the exact reviewed PDF bytes. Corrections create new versions; they do not overwrite files already shared. Generate selected vaccine/certificate/record PDFs from existing renderers and reviewed release scope rather than printing the entire chart indiscriminately.
7. Keep original diagnostic PDFs available alongside generated summaries. Graphs, units, dates, patient identifiers, source and reviewer information must be legible on multi-page output. PDF metadata and storage names must not leak private links.
8. Create the render job in the same database transaction that records the reviewed snapshot, then render/upload asynchronously. Bind final artifact registration to that job/version/hash. Reconcile uploaded-but-unregistered files and pending jobs after crashes; use existing cleanup conventions without deleting a referenced clinical artifact. A permanently failed job remains visible with an owner and recovery action.
9. The renderer receives only the authorized immutable source manifest and necessary display fields. It must not fetch arbitrary URLs, execute uploaded markup or receive general database/service credentials. Prove runtime, private-source access, size/time limits, output validity, storage registration and retry behavior in the Phase 0 spike before fixing the deployment design.

## Files and schema

| Action | Absolute path | Change |
|---|---|---|
| Modify | `/Users/davidedler/Developer/lrv-feedback-plan-20261008/src/hub/features/lab-work/PatientLabWork.tsx` | Structured manual entry and workflow |
| Modify | `/Users/davidedler/Developer/lrv-feedback-plan-20261008/src/hub/features/lab-work/PatientLabResults.tsx` | Result review, graph history and PDF status |
| Modify | `/Users/davidedler/Developer/lrv-feedback-plan-20261008/src/hub/features/record-releases/RecordReleaseArtifact.tsx` | PDF artifact preview/download alongside existing history |
| Modify | `/Users/davidedler/Developer/lrv-feedback-plan-20261008/supabase/functions/_shared/release-email-payload.ts` | Frozen PDF attachment contract |
| Modify | `/Users/davidedler/Developer/lrv-feedback-plan-20261008/src/hub/features/certificates/PatientCertificates.tsx` | Reviewed PDF path, preserving issuer requirements |
| Create | `/Users/davidedler/Developer/lrv-feedback-plan-20261008/src/hub/features/diagnostics/` | Observation model, comparable series and charts |
| Create | `/Users/davidedler/Developer/lrv-feedback-plan-20261008/supabase/migrations/<next>_diagnostic_observations_and_artifacts.sql` | Observation/correction/artifact lifecycle and permissions |
| Create after runtime proof | `/Users/davidedler/Developer/lrv-feedback-plan-20261008/services/report-renderer/` | Isolated PDF rendering service/worker; location may change with approved deployment design |

## Acceptance

- [ ] Enter an in-house numeric and qualitative panel; save/reopen/finalize; author and reviewer are attributed.
- [ ] Two compatible results graph correctly; incompatible units/specimens split visibly; blank values never become zero.
- [ ] A corrected value preserves the original and its PDF; current views identify the current version.
- [ ] Generated bytes are an actual readable PDF, include the reviewed values/graphs and survive reload/download/email. Test long tables, page breaks, special characters and source labels.
- [ ] Rendering retry never duplicates reports or changes the reviewed version; cross-patient or unauthorized artifact access fails.
- [ ] Crash after snapshot commit and after upload but before artifact registration: the job is recoverable, the exact version is retained, and referenced files survive cleanup. Oversized/invalid documents and unauthorized source URLs fail visibly without exposing private data.
- [ ] Vaccine-only release contains only selected vaccine/certificate material; historical records do not become newly signed rabies certificates.
- [ ] Add SQL provenance tests, chart grouping tests, PDF-content/visual verification and one full browser → renderer → Storage → attachment round trip on synthetic data.

**Risks:** incompatible medical measurements, stale PDF versions and renderer runtime limitations. Use explicit comparison rules and version/hash binding. Dr. Edler reviews result and certificate layouts; graphs provide history, not automated diagnosis.

Package 3B1 is approved, merged and deployed in [PR #240](https://github.com/finite0001/livingroom-vet-care/pull/240), merge `14be15205456af9ce98930b4d62b5c4ee3adff09`. Both hosted backends have 175 migrations; 46 rollback checks passed on each and 60 genuine deployed staging checks passed including cleanup. [3B1 hosted receipt](../../docs/launch-evidence/2026-10-11-diagnostic-pdf-jobs-rollout.md). Clinical worker/release/disclosure policies remain empty/off; existing captures remain unvalidated/unuploaded/non-exportable.

Package 3B2A isolated rendering and strict PDF admission is implemented in [PR #241](https://github.com/finite0001/livingroom-vet-care/pull/241), head `b54d4428219526c090cfe0841e8380b88332f44c`; all exact-head CI passed; #241 is approved, merged and production READY. The final native hosted proof rendered 100 findings across 22 pages, verified sandbox/network/non-root/actual-byte admission and whole-VM descendant expiry. All 15 owned trial VMs are stopped with no snapshot; eight obsolete image records were removed. Local checks: 1,320 unit tests, 20 PDF counterexamples, typecheck/lint/build. [3B2A plan](../2026-10-11-diagnostic-pdf-renderer/plan.md) / [renderer evidence](../../docs/launch-evidence/2026-10-11-diagnostic-pdf-renderer.md).

3B2B registration,3C/#243 staff review/download and3A2a/#244 scope review are merged and rolled out default-off.3A2b/#245 numbered diagnostic sharing is approved, merged and rolled out default-off to both179 backends. All 45 requirements and real practice acceptance remain required.

Package 3B2B is implemented in [PR #242](https://github.com/finite0001/livingroom-vet-care/pull/242), head `0af5c25a2561391fbcc53f13d6f01d8a75a329be`; all required exact-head CI passed; #242 approved, merged as `ef12883e2a86c99c80ecaecec9f8facc791bbc73`, and rolled out default-off to both backends. Local verification: 1,336 unit tests, 143 SQL files / 5,834 assertions, and 45 genuine Auth/Storage/native Sandbox checks including four lost acknowledgements, owner handoff, observed locks and populated restore. All 25 new trial VMs were independently verified stopped with no snapshots. Repository179 on #245; hosted baseline178 after approved #244. Worker/release/disclosure policies remain off.

Final #242 verification: all required checks pass at `0af5c25a2561391fbcc53f13d6f01d8a75a329be`; 1,336 unit tests, 520 browser passes/one existing skip, 5,834 SQL assertions and 45 genuine native amd64 registration checks. [CI receipt](../../docs/launch-evidence/2026-10-11-diagnostic-pdf-registration-ci.json). Next: [3C staff review/private download](../2026-10-11-diagnostic-pdf-review/plan.md). #242 merge and hosted rollout are complete; [rollout receipt](../../docs/launch-evidence/2026-10-12-diagnostic-pdf-registration-rollout.md).

Current staff next-visit/#249 status: approved, merged and production/domain verified; repository/staging/primary183. Both passed49 rollback assertions; staging25 Auth/API +19 browser checks. [Hosted receipt](../../docs/launch-evidence/2026-10-13-next-visit-staff-rollout.json). [4B detailed design](../2026-10-13-operational-tasks/plan.md) is prepared, not implemented or enabled. 4C daily tasks and Susan acceptance remain open. All45 original requirements retained.
