# Reviewed API-original clinical acceptance preparation

Baseline: `69f509aa98189d774e6d16768417b4f96999a1f6` (PR130). Review preparation and focused UI wording corrections, independent of the migration-reconciliation work in another workspace.

## Deliverables

- [x] Translate chart admission, DVM acknowledgment and schema9 package behavior into a supervised synthetic review script.
- [x] Add an unfilled, per-case decision worksheet; preserve the distinction between clinical review and operational activation.
- [x] Link C12 and schema9 D02/D04 review from the pack index without relabeling older rendered examples.
- [x] Correct stale chart release-exclusion copy, clarify per-family/delivery limits and explain the existing DVM chart-download handoff in the package preview. Do not broaden file-access permissions or weaken the review attestation.
- [ ] Conduct the signed-in review with Dr. Susan Edler and record the actual deployed revision and outcomes.
- [ ] Resolve requested changes and repeat affected cases before separate release-policy activation.

Files: `docs/clinical-review/api-originals-and-release.md` (new script), `api-originals-session-worksheet.md` in the same directory (new worksheet), and `docs/clinical-review/README.md` (index update).

Additional files: `src/hub/features/imports/PatientAttachmentOriginals.tsx` and `src/hub/features/record-releases/PatientRecordReleases.tsx` (wording and conditional review guidance only).

Validation: compare case expectations against the exact source and contracts, independently review permissions and acknowledgment wording, check local Markdown links and `git diff --check`; run lint/typecheck and the existing affected browser scenarios. No database/runtime authority changes; SQL, provider and restore suites need no local rerun for this increment.

Local results: lint and typecheck passed (one existing AuthContext Fast Refresh warning); all six selected chart/release browser scenarios passed; 23 relative Markdown links resolve. Independent source review identified the corrected copy and the explicitly documented preview/download limitation. Clinical session results remain unrecorded.

Choice: extend the existing review pack instead of creating another approval UI or regenerating older schema4–6 artifacts. This supplies a usable review session without implying synthetic fixtures are actual clinical approval.

Unresolved: Dr. Edler's session availability and clinical wording decisions; verified hosted revision/accounts for the session; separate operational policy activation and live practice-source acceptance. No new credentials are requested.
