# Phase1 — Database snapshot and lifecycle

Priority: high. Status: pending. Depends on PR102 and an agreed schema5 projection shared with phase2.

## Source context

Read release migrations1300/1600/2000/2200/2500, lab provenance4100, external provenance4200, and `docs/record-releases.md`, `docs/plans/ezyvet-historical-records.md`. Root checkout: `/Users/davidedler/livingroom-vet-release-provenance-plan`; paths below are relative to that checkout and must be resolved in each isolated worktree. Historical migrations are reference material; do not edit them.

## Contract

1. Add `preview_record_release_v5` with the existing preview arguments. Add optional unique UUID arrays `lab_report_ids` and `external_record_ids`, bounded consistently with existing selection families. Empty/omitted means none. Preserve old preview entry points.
2. Add versioned discovery/select-all RPCs for the new source families rather than changing legacy consumer contracts. Return immutable version IDs, eligible original ID/version, display source identity, original/corrected/replacement and historical status, acknowledgment summary, pagination/truncation information and `policy_v5_accepted`.
3. Require explicit matching `document_ids` for each selected version. Check patient, ready/shareable status, document/capture version, MIME, size and immutable verified capture. Staged/unapproved receipts and cross-patient associations are ineligible. Resolve duplicate originals deterministically; conflicting source digests for one original fail.
4. Schema5 retains the v4 fields and adds ordered `lab_reports` and `external_records` arrays. Each whitelisted projection includes version/predecessor, source identity/environment, staff-reviewed entry method, report/export reference and dates, historical/current status, exact document/version, captured content SHA256 and explicit per-version acknowledgment evidence. Do not include raw provider payloads, credentials, Storage paths in public provenance sections, private review reasons or unrelated chart content. Stored attachment references remain private as today.
5. Finalize field names/types jointly with the shared renderer before parallel implementation. Document exactly which local approval/acknowledgment identity and timestamp each field represents. A byte digest is not evidence of provider authenticity; a DVM acknowledgment is not the outside clinician's signature or an endorsement of every finding.
6. Preserve schema1–4 internal preview functions and dispatch `release_read_internal` by stored schema. Exact committed UUID recovery must return before fresh eligibility checks. New confirmation through an old schema must reject documents now backed by provenance that the old preview cannot display; omitted provenance selection cannot serve as a downgrade.
7. Extend policy constraint to5 and expose an independent v5 gate. Do not create or update an enabled policy or acceptance date. Existing version-specific acceptance remains meaningful.

## Locks and source changes

- Lab linking currently locks lab order then document. External approval locks animal link then patient then document. Acquire all selected lab/order and animal-link anchors in deterministic order before delegating to patient/document release validation; inspect mixed-selection ordering against every existing writer before coding.
- Amend acknowledgment RPCs additively to lock their corresponding order/link anchor before document, then insert acknowledgment. A new insert trigger that acquires the anchor after a document lock would invert the order.
- Register `lab_report` and `external_record` in `record_release_sources`. Corrected/replacement versions, changed source review and new acknowledgments must serialize with confirmation and final delivery inspection and invalidate affected schema5 releases with safe reasons.
- New provenance-association insertion must invalidate releases through selected document-source references across every schema, including v5 packages created before a second association existed; report-ID tracking alone misses those cases. Existing document/patient invalidation remains. For old confirmed releases containing a document that gains newly approved provenance, preserve the original snapshot/recovery but fail fresh delivery if it would bypass the newly required review. Record a source-change event rather than rewriting historical content. Test and document this case explicitly.
- Add a read-time fail-closed association check for legacy releases whose selected documents already gained4100/4200 approval before4700 was installed. Future insert triggers cannot cover those existing associations. Preserve the old snapshot/hash/request and receipt-first recovery; change only current eligibility. Test release creation → provenance approval under the old schema →4700 upgrade → fresh delivery denied, plus an association approved after upgrade.
- Historical versions remain selectable with their actual supersession lineage. A newly arriving correction or acknowledgment after review requires a new preview; it must not silently update an existing artifact.

## Files

Create an additive migration after4600; focused pgTAP and actual contention tests under `supabase/tests/`. Update generated Supabase RPC types after applying locally. Reuse narrow internal helpers; no broad direct-table grants. Preserve service/anon/authenticated boundaries and active actor checks.

## Acceptance

- [ ] Same-patient, exact-document/capture, private/void/missing object and stale-version rejection.
- [ ] Accurate unacknowledged, acknowledged, original and historical projections; escaped free text is phase2's responsibility.
- [ ] Absent/older acceptance blocks v5 confirmation; exact committed retries survive later invalidation, changed retries fail.
- [ ] Old snapshots/hash/UUID recovery remain unchanged; legacy fresh-confirmation downgrade rejected.
- [ ] Real lock tests cover both orders for confirmation versus correction/replacement, acknowledgment and document void; mixed source selections do not deadlock.
- [ ] Source invalidation blocks release email and document-link final preflight with zero attempts.
- [ ] Schema migration preserves original metadata, native notes, inventory and financial ledgers. No provider or hosted mutations.

Risk: frozen fields becoming live lookups would change old artifacts or misattribute external authorship. Mitigation: explicit versioned snapshots, whitelisted projection and compatibility fixtures; review by phase2 owner before integration.
