# Deterministic call-note quote anchors

## Problem and scope

The October 18 ten-case fictional evaluation returned ten complete HTTP 200 responses but only one passed the existing citation contract. All cited quotes were literal substrings; model-supplied UTF-16 ranges and two copied hashes caused failures. The mechanically passing case also had a clause-support concern. These observations are engineering findings, not clinical adjudication or an accuracy estimate.

Implement a new provider protocol without changing the canonical stored clinical payload, excerpt/assembly rules, patient attribution, approval gates or clinician review/signing requirements. Original requests, outputs, failed packets and source inventories remain immutable in their pinned checkout. Never repair or reclassify those original failures.

## Contract and provenance

1. Use provider payload `clinical-call-note-provider-payload-v2`, prompt `lrv-call-note-fields-v2`, schema `clinical_call_note_fields_v2`, result `clinical-call-note-result-v2`, and resolver `lrv-call-unique-literal-v1`. Keep veterinary vocabulary and canonical `clinical-call-note-payload-v1` unchanged.
2. Model supports contain only a retained `segment_ordinal` and literal `quote`. Resolve within that exact segment only. Require one exact occurrence, rejecting absent and repeated matches, including overlaps. Derive the trusted segment hash and JavaScript UTF-16 range, then invoke the existing strict canonical validator. Do not normalize, fuzz, search other segments, select the first duplicate or change claim text/patient scope.
3. Record exact bounded complete HTTP-response-byte SHA256 and UTF-8 SHA256 of the decoded assistant output-text string, plus provider/resolver versions. Compute the response hash at the byte-reading boundary; never reconstruct it from parsed JSON. Complete-but-invalid responses retain safe digest evidence through the failure allowlist. Partial bytes cannot be labeled a complete-response digest.
4. New results require the new strict provenance manifest. Historical readers explicitly support old v1 and new v2 manifests. A new additive migration updates finish/failure guards without weakening permissions, live policy/source/session checks, completed-attempt idempotency or review restrictions. Do not broadly admit old manifests for new attempts.

## Ownership

- Provider worker: provider, handler and processing-model shared files; focused provider/handler/model fixtures/tests.
- Database worker: additive migration, SQL assertions and owned call-generation runtime/restore probes; preserve all existing migrations and canonical clinical validation.
- Root: this plan, integration, evaluation revision/planner/probe/profile updates, shared migration-count inventories, review, release receipts and final verification. Separate worktree from the still-cleaning original evaluation.

Contributors are not alone in the repository and must accommodate concurrent edits rather than reverting them.

## Verification

Prove exact unique, absent, repeated/overlapping and wrong-segment behavior; Unicode/astral boundaries; full/partial byte-hash provenance; strict manifest/tamper rejection; unchanged claim attribution and selected SOAP assembly; historical v1 reads; old completed-attempt replay; new v2 finish/recovery; SQL grants and clinician review restrictions. Use adapted fictional fixtures labeled as adaptations, never new provider evidence. Run focused tests, strict/cached Edge checks, repository checks and current-migration owned SQL/Auth/restore/browser verification as appropriate.

Publish a fresh offline corpus revision preserving the ten scenarios and mandatory/forbidden meanings, with fresh request/source hashes and a rebound published-rate profile. Negative controls must remain structural-pass/semantic-fail. Keep old runner/bundle receipts version-bound to their immutable checkout. Preparation cannot reuse the old ten-request authorization or dispatch more model calls. Any subsequent paid evaluation needs its own exact reviewed scope and reservation; clinical policy, provider commissioning and real iPhone/Safari acceptance remain separate.

## Release boundary

The owner authorized completed-code merges and deployments in this task. Publish only after independent review and exact-head CI. Roll out an additive migration before its matching worker/frontend, with call capture/generation gates still off. Preserve existing data, secret digests and unrelated function configuration. No practice policy approval, clinical activation, signing, delivery or further provider requests are included in implementing this correction.

Proof reporting: the legacy receipt key `actual_auth_api_assertions` counts combined local Auth/PostgREST, SQL-state, setup/process and restore assertions. It is not an HTTP-only count. Keep worker HTTP, browser, observed-wait and restore counters separate; do not fabricate a request total.
