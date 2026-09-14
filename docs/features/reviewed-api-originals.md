# Reviewed ezyVet API originals

Status: implemented and locally verified. Hosted commissioning remains pending. Builds on merged PR128 capture receipts and canonical migration 7000; additive migration 7100 introduces chart review.

## Staff workflow

The patient chart has a separate API-original history. An active administrator sees their own ready captures, downloads checksum-verified bytes, reviews the source and patient association, enters a reason and explicitly admits the original. An administrator cannot admit another user's private capture. The original remains in its private bucket with its unchanged `ezyvet_api_attachment_original_v1` capture receipt; the chart records the separate `staff_reviewed_ezyvet_api_attachment_v1` admission.

Admission requires the current mapped patient, household and reviewed patient version. Older attachment observations can be admitted as historical evidence. Original source timestamps and whether the observation was current at review are preserved; admission does not claim the provider still serves the same record.

Active staff can read chart provenance and history. A DVM downloads the admitted original through a separate verified retrieval endpoint, then explicitly acknowledges the exact chart record and capture hash. ADMIN alone does not grant DVM acknowledgment or chart-download access. The original administrator's existing capture retrieval remains available under its existing ownership rules.

A replacement selects the current previous record and a different captured original. The database serializes the source attachment series and appends a version. Prior acknowledgments remain attached to their original version. An administrator can withdraw the current version with a reason; withdrawal preserves its bytes, history and prior acknowledgments. DVMs can still download replaced or withdrawn originals as historical evidence, while new acknowledgments require the latest nonwithdrawn record.

## Recovery and access

Browser operations save an actor/patient-scoped UUID and exact arguments before submission. Unknown responses recover the immutable server action before retry. Explicit abandonment uses the same UUID lock and scoped arguments: it either returns the committed action or records an abandoned tombstone. A delayed request cannot revive an abandoned operation. Recovery remains independent of the currently visible history page.

The patient panel participates in the shared clinical draft navigation guard. Account changes invalidate late responses. Browser downloads are independently hashed, remain in memory, and their object URLs are revoked when no longer needed.

The DVM endpoint checks the admitted record and patient, validates its original owner/path and immutable byte receipt, reads within the PDF/JPEG/PNG and 20 MiB limits, and rechecks authorization and the Storage object identity before returning bytes. Responses use attachment disposition, no-store and nosniff. It requires no provider credentials or active import mode. Direct browser Storage reads, overwrites and deletes remain denied.

## Boundaries

This chart evidence does not create `patient_documents`, manual-export receipts, SOAP notes, diagnoses, treatments, billing, reminders or messages. Existing client release selection and delivery cannot select API-original chart records. API-original release support requires a subsequent provenance contract and matching email/document-link validation.

Live source acceptance, Dr. Susan Edler's clinical-form review, additional attachment parent types and whole-migration reconciliation remain separate work. No hosted deployment or provider operation is part of this local increment.

## Validation

Local validation:

- 534 unit tests, lint, TypeScript and the production build passed with the final UI fixes. All 32 Edge entrypoints passed frozen Deno checks.
- All 288 browser cases passed across full and focused runs: the 286-case full run passed 285, its existing client-address timeout passed three serial reruns without changes, and two subsequent failed-reread regressions passed separately. This was not a single clean full-suite run. The new workflow includes 19 browser scenarios.
- The broad SQL run passed 74 files / 2,752 assertions. Final review tests passed 53 assertions, including release exclusions and raw reason bounds; the final targeted lane passed 471 assertions and 96 contention/setup/cleanup checks. Earlier broad contention passed 160 checks and the canonical child passed 468 assertions / 162 checks. See the [SQL and contention receipt](../evidence/attachment-original-review-sql-contention-local-20260914.json).
- Final actual local HTTP/Auth/PostgREST/Storage acceptance passed 133 checks (50 metadata, 83 capture/chart review), with synthetic provider responses and the handler harness, not a deployed Edge gateway. An earlier parallel run hit a database statement timeout during concurrent local restores; the final sequential rerun passed without changing application timeouts. Owned resources were cleaned up. See the [HTTP receipt](../evidence/attachment-original-review-http-local-20260914.json).
- Fresh populated 51→88 restore passed: three originals (two ready, one reserved), six immutable actions, two admitted versions, two DVM acknowledgments and one withdrawal survived. Original bytes, owned action recovery and history were verified. Canonical permissions matched before and after restore; owned resources were cleaned up. See the [restore receipt](../evidence/attachment-original-review-restore-local-20260914.json).

No live provider or hosted acceptance is implied. See the [implementation contract](../plans/attachment-original-review-contract.md).
