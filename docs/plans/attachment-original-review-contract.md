# API-original clinical review and chart evidence — implementation contract

Baseline: merged PR128 (`705d7a1`), canonical87 migrations. Add7100 only. Preserve7000 capture ownership, immutable bytes, original bucket and existing manual export/document/release contracts. This increment uses synthetic local tests only; no hosted or provider operations.

## Complete bounded outcome

An active ADMIN who owns a ready original capture downloads and verifies it, reviews source/patient identity, and explicitly admits it into a dedicated patient-chart evidence family. Active staff can read admitted metadata/history. Active DVMs can download admitted originals and acknowledge the exact latest nonwithdrawn record. Active ADMINs may withdraw the exact latest record with a reason. Withdrawal is append-only: the original, record and earlier acknowledgments remain available as historical evidence. Replacement explicitly appends a new record with a different capture and the reviewed previous record ID.

No patient_documents row, copied Storage object, manual external_record_* row, clinical diagnosis, treatment, invoice, release source, client-shareable document or message is created. No existing release selection family or policy version changes. All original bytes stay in ezyvet-attachment-originals with no new browser Storage SELECT/UPDATE/DELETE grants. Admission and DVM acknowledgment are separate claims; approval alone does not assert a veterinarian reviewed the contents.

## Shared types and validation

All JSON objects are exact allowlisted shapes, including nested objects. UUIDs are canonical UUID strings; hashes are lowercase64hex; timestamps are finite ISO timestamps. Decimal source IDs and Metadata use the exact canonical6900 parser types. Nullable fields are present as null. No bucket/path, lease, object UUID, credentials, raw provider JSON or URL capability appears in browser projections.

`Record` (immutable fields only):
```
{id, action_id, approved_by, approved_at, pet_id, client_id, patient_version,
 animal_link_id, capture_id, capture_request_id, capture_hash, request_hash,
 record_hash, source_origin, source_site_uid, source_animal_id,
 source_attachment_id, source_file_id, snapshot_id, observed_head_version,
 stable_metadata_sha256, raw_record_sha256, metadata,
 content_sha256, mime_type, file_size, captured_at,
 entry_method:'staff_reviewed_ezyvet_api_attachment_v1',
 source_current_at_review, previous_record_id, version,
 kind:'original'|'replacement', review_reason}
```
`capture_hash` is the unchanged7000 immutable capture hash; `request_hash` is the exact review action payload hash, NOT the7000 capture request hash. `record_hash` binds every immutable admission fact (including identity, previous/version, reviewer/reason and byte provenance); exclude the record_hash field itself. Server derives all source and byte facts from capture/request/intent, never browser metadata. Metadata remains the sanitized canonical6900 shape. The capture entry method remains ezyvet_api_attachment_original_v1 in7000 and is never relabeled as a manual export.

`Acknowledgment`: `{id,action_id,record_id,pet_id,actor_id,record_hash,capture_hash,created_at}`.
`Withdrawal`: `{id,action_id,record_id,pet_id,actor_id,record_hash,reason,created_at}`.
`Action`: `{id,action:'approve'|'acknowledge'|'withdraw',actor_id,pet_id,request_hash,status:'committed'|'abandoned',created_at,record:Record|null,acknowledgment:Acknowledgment|null,withdrawal:Withdrawal|null}`.
Committed action contains exactly its corresponding result; abandoned action contains all three null. IDs of result records are server-generated, distinct from action UUID. Action payload/hash and result are immutable. Exact recovery never recomputes a mutable history projection.

`HistoryRow`: `{record:Record,latest_record_id,is_latest,withdrawal:Withdrawal|null,acknowledgments:Acknowledgment[]}`. Withdrawal belongs to this exact record; an older withdrawn record can have a later replacement. Sort acknowledgments by created_at then id ascending. Existing record metadata/history remains readable after current source or household changes.

`Cursor`: `{before_at,before_id}`. Cursor pair bothnull/bothvalid, finite time, limit1–50 default20. All pages order timestamp then UUID descending, fetch limit+1, next_cursor is last returned row only when has_more=true; otherwise null. Unknown/other-owner recovery returns null without existence disclosure, subject to current caller role eligibility.

## Browser RPCs

All mutations use auth.uid(); no caller-supplied actor. Validate exact payload and role before action recovery. Capture ownership required for new approval and scoped abandonment, but committed action recovery validates the frozen owned action rather than mutable source eligibility.

```
approve_ezyvet_attachment_original(
 p_id uuid,p_pet_id uuid,p_capture_id uuid,p_expected_capture_hash text,
 p_expected_patient_version integer,p_previous_record_id uuid,
 p_review_reason text,p_attest boolean) -> Action
```
Require active ADMIN and capture.requested_by=auth.uid(), ready immutable capture, explicit true attestation, reason raw character length at most2000 and trimmed length1–2000, exact capture hash and expected current patient version. First recover an existing action under the UUID lock: all original inputs/actor/action must match; committed or abandoned returns unchanged. For NEW approval, lock current mapping/patient identity and require capture's frozen pet/client, source origin/site/animal and mapping still agree with the current mapping and patient household. Historical attachment/Animal heads are allowed deliberately; do not call7000 ezyvet_attachment_capture_lock_source. Freeze source_current_at_review from7000 currentness while using source locks described below. The reviewer attests to this captured historical original, not current provider contents.

The series key is `(source_origin,source_site_uid,source_animal_id,source_attachment_id)`, not filename/file_id, mapping UUID or content hash. Serialize series decisions with a shared advisory lock. Require supplied previous_record_id equals latest series record, or null when none; previous series record must have same pet_id. A first record gets version1/kind original; later records increment/version replacement. Reusing any already admitted capture is rejected, including under another action UUID. Replacement must use a different immutable capture ID; equal bytes are allowed as separate source observations and never silently merged. A withdrawn latest record can be explicitly replaced. Validate Storage object UUID and exact MIME/size against immutable7000 capture before new admission; no SQL claim to rehash physical bytes. Browser must have verified a download matching capture hash/bytes before enabling attestation.

```
acknowledge_ezyvet_attachment_original(
 p_id uuid,p_pet_id uuid,p_record_id uuid,p_expected_record_hash text,
 p_expected_capture_hash text,p_attest boolean) -> Action
withdraw_ezyvet_attachment_original(
 p_id uuid,p_pet_id uuid,p_record_id uuid,p_expected_record_hash text,
 p_reason text) -> Action
recover_ezyvet_attachment_review_action(p_id uuid,p_pet_id uuid) -> Action|null
```
Acknowledgment requires active DVM, explicit true, exact admitted record/patient/hash/capture hash, latest series head and no withdrawal. One acknowledgment per(record,actor); a different UUID duplicating that acknowledgment rejects and cannot return another action as if owned by the new UUID. Committed same-UUID recovery works after replacement/withdrawal. No current patient/source requirement for acknowledgment of an admitted latest historical original. DVM UI must verify the exact record download before attestation.

Withdrawal requires active ADMIN, exact latest record/pet/hash, reason raw character length at most2000 and trimmed length1–2000 and no earlier withdrawal for this record. It need not be the original capturer/approver. One withdrawal per record; conflicting second action rejects. Series lock serializes withdrawal, replacement and acknowledgment. If acknowledgment wins first, retain it and permit withdrawal; if withdrawal wins first, deny new acknowledgment. If replacement wins first, deny withdrawal/acknowledgment of the superseded head. Committed recovery is independent of current head and history pagination.

Recovery requires active staff and current role for the action family (ADMIN approve/withdraw, DVM acknowledge), auth.uid ownership and supplied pet. It works even when another clinician's acknowledgments or newer records push the action off the current chart page.

Each mutation has a same-argument companion named respectively:
`abandon_ezyvet_attachment_original_approval`, `abandon_ezyvet_attachment_original_acknowledgment`, `abandon_ezyvet_attachment_original_withdrawal` -> Action.
Under the SAME UUID lock these companions return an existing exact action unchanged. If absent, validate caller role, exact payload and immutable scoped capture/record ownership/access and hash; skip mutable patient version/head/withdrawal eligibility and create an abandoned action tombstone. Approval abandonment still requires ready owned capture and exact immutable source binding; acknowledgment/withdrawal abandonment requires exact admitted record/patient/hash and appropriate role. Do not create arbitrary UUID-only tombstones. Late mutations recover abandoned status and cannot commit. UI clears uncertain local intent only after recovering a committed result or an abandoned receipt, never after a null response alone.

```
list_ezyvet_attachment_original_candidates(
 p_pet_id uuid,p_before_at timestamptz=null,p_before_id uuid=null,p_limit integer=20)
 -> {candidates:Candidate[],has_more,next_cursor}
read_ezyvet_attachment_original_history(
 p_pet_id uuid,p_before_at timestamptz=null,p_before_id uuid=null,p_limit integer=20)
 -> {pet_id,records:HistoryRow[],has_more,next_cursor}
```
Candidate discovery requires active ADMIN, only its own ready captures for frozen pet, ordered capture.captured_at/capture.id. Include already admitted captures so deterministic prior-result recovery is possible; mark them explicitly. Do not filter stale heads or changed household out of historical discovery.
`Candidate`: `{capture_id,capture_request_id,pet_id,client_id,animal_link_id,capture_hash,content_sha256,mime_type,file_size,captured_at,metadata,source_origin,source_site_uid,source_animal_id,source_attachment_id,source_file_id,source_current,patient_version,mapping_current,latest_record:Record|null,admitted_record:Record|null}`.
patient_version is current pets.version. mapping_current describes current frozen mapping/pet/client/source identity agreement; false disables new approval but not owned byte retrieval. latest_record is latest admitted series version; admitted_record identifies this capture's already admitted record. History requires active staff and existing patient, ordered Record.approved_at/id. Ordinary staff metadata access does not grant original downloads.

## Download boundary

Keep existing owner-admin capture retrieve endpoint and permissions unchanged. New Edge function `retrieve-reviewed-ezyvet-attachment`, POST exactly `{record_id,pet_id}`; active DVM bearer required. It performs no provider request and needs no ezyVet configuration. Service-only RPC:
```
get_ezyvet_attachment_original_review_context(
 p_record_id uuid,p_pet_id uuid,p_actor uuid)
 -> {record:Record,original:{bucket_id,object_path,storage_object_id,
 content_sha256,mime_type,file_size}}
```
Validate active DVM + exact admitted record/patient before returning private context. Historical, replaced and withdrawn admitted originals remain downloadable as clinical evidence; never permit unapproved captures via this RPC. Revalidate actor/context after readback before returning bytes. Download exact immutable original path with service credentials, bounded20MiB, verify SHA256, MIME/signature, length and Storage object identity. No browser signed URLs or direct Storage permissions; return attachment bytes with no-store/nosniff and safe server-generated filename. Browser independently rehashes against Record before offering download/acknowledgment. Error bodies use fixed safe codes and never expose paths/provider data. Missing or tampered bytes fail closed, not empty success.

## Database boundaries and lock order

New7100 private tables for action intents/results, admitted records, acknowledgments and withdrawals: RLS enabled, revoke all table privileges from public/anon/authenticated/service_role, append-only guards and necessary unique/FK constraints. Grant only named browser RPCs to authenticated and download context to service_role; revoke helper execution. No widened7000 owner APIs or generic import review grants.

Action advisory lock → capture/request row (approval only) → mapping/patient/Animal head → source attachment advisory gate → attachment head → series advisory lock → original Storage object. Obtain source/head locks only for new approval; use them to freeze the source_current_at_review observation without requiring those heads to equal the old capture. Acquire mapping/patient locks in the same order as6900/7000. Acknowledgment/withdrawal use action then series locks and never take source/capture locks afterward. No locks across HTTP. Exact committed/tombstone replay occurs before mutable locks/currentness. No new capture/download/cleanup lifecycle and no mutation of7000 ready requests.

Release exclusion is structural: no patient_documents entry, no external_record_versions entry, no new record_release_sources source_kind, no selection key. Prove all current release candidate/select-all/preview/confirm/link/email paths cannot include a new API chart record and preserve existing frozen snapshots. Reject attempts to substitute API IDs in document/external-record families. Admission/ack/withdrawal does not invalidate unrelated releases.

## Verification

DB: hostile null/input substitution, UUID conflict/owner/role denial, abandoned late request in both orders, historical attachment admission with current mapped household, household/version movement denying new approval, immutable approved recovery after changes, duplicate capture/series version, replacement/ack/withdrawal both-order locks, other-actor recovery, pagination and action recovery beyond current page, private-helper/direct-table denial, no native/release side effects. Actual HTTP: DVM-only verified ready/historical/withdrawn downloads, no owner widening, no unapproved capture access, role removal, wrong patient, missing/same-size corrupted Storage bytes, no provider/config dependency. UI: exact-schema/actor/pet/hash checks, independently verified download gates, ADMIN and DVM role differences, pending-intent recovery/tombstones, historical display and dirty-form arbitration. Restore populated admitted/replaced/withdrawn evidence and acknowledgments with original physical bytes, canonical51→88 inventory and cleanup. Keep full SQL/canonical contention opt-in in the dedicated harness; CI has separate canonical lanes.
