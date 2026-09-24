# Schema5 release source contract

Implementation contract for4700/4800. No clinical acceptance is recorded by these migrations.

`preview_record_release_v5(p_pet_id,p_client_id,p_channel,p_recipient,p_selection)` always emits schema5, including ordinary-only packages. It preserves existing fields, supplies missing source arrays as empty arrays and adds `lab_reports`/`external_records`. Selection adds `lab_report_ids`/`external_record_ids`; each needs its exact document in `document_ids`. Every approved version associated with a selected document must be selected explicitly. Arrays contain unique UUIDs, at most100 per family. All versions remain independently selectable, including historical versions, with exact originals.

Both source arrays have these fields:

- `id`:UUID; `version`:positive integer; `kind`:original/corrected for labs, original/replacement for external records.
- `previous_version_id`:UUID|null; `latest_version_id`:UUID; `historical`:boolean.
- `document_id`:UUID; `document_version`:positive integer; `mime_type`:string; `file_size`:integer bytes.
- `receipt_id`:UUID; `receipt_hash`,`capture_hash`,`content_sha256`:lowercase64-hex strings.
- `received_at`:timestamp from staff-entered receipt; `reviewed_by`:UUID and `reviewed_at`:timestamp from the immutable local version-link/approval row. They do not identify the unknown outside author.
- `acknowledgments`:ordered array of `{id,acknowledged_by,acknowledged_at,capture_hash,document_version}`, taken only from acknowledgments of that exact immutable version. Empty means no recorded acknowledgment, never automatic review.

Lab entries also have `order_id`,`source_account_id`,`source_review_id`,`latest_source_review_id` UUIDs and `source:{provider_label,account_reference,environment_label,entry_method:'staff_entered_v1',source_patient_reference,source_order_reference,source_report_reference}`.

External entries also have `animal_link_id` UUID and `source:{provider_label:'ezyVet',source_origin,source_site_uid,source_animal_id,entry_method:'staff_reviewed_manual_export_v1',export_reference}`.

A provenance-backed attachment retains existing private metadata and adds `content_sha256` plus ordered `provenance_captures:[{family:'lab_report'|'external_record',version_id,receipt_id,receipt_hash,capture_hash}]`. Each proof matches exactly one selected source row; inverse membership is required. Document/version/MIME/size/digest must agree across all rows sharing a document. Ordinary unbacked attachments have neither field. Private reasons, raw source payloads and credentials are excluded.

`list_record_release_sources_v5(p_pet_id,p_offset=0)` preserves existing source-list fields and12 arrays, adds the two new candidate arrays, `policy_v5_accepted`, and `has_more:{[each of14familykeys]:boolean}`. Each family returns at most100 rows at the same offset. New candidates have existing `id,version,recorded_at,label,required_document_id,file_size,mime_type`, plus `required_document_version,kind,historical,source_label,acknowledgment_count`. All document candidates additionally have `required_lab_report_ids` and `required_external_record_ids`, including empty arrays. Pagination does not imply unseen rows are selected.

`select_all_record_release_sources_v5(p_pet_id)` preserves `{selection,excluded_unavailable_originals,excluded_labs_without_shareable_original,scope}` and always includes all fourteen selection arrays (empty arrays for absent families). It errors if a family exceeds100 rather than returning an incomplete all-selection. No additional exclusion counters are introduced.

Old preview/discovery entrypoints remain unchanged. New old-schema confirmation cannot omit known provenance; exact already-committed request replay remains receipt-first. Legacy snapshots/hashes stay immutable while present-day delivery eligibility fails when selected documents gained approved provenance, including associations that predate4700. New associations invalidate document-referencing releases across every schema.

A changed current lab account/patient/order identity makes the original ineligible for fresh release until the mapping is resolved. A later review of the same identity preserves historical version selection but changes `latest_source_review_id` in the frozen snapshot; disclose it alongside the report's original source review.

## Local verification

4700 passed33 focused PostgreSQL assertions,175 existing release/chart/email/document-link assertions, and63 checks with observed lock holders and waiters. Contention covers both commit orders for lab corrections, external replacements, each acknowledgment family and document voiding. Mixed legacy/v5 and v5/v5 previews include a signed dental chart and the same native lab order as the selected report.

The contention runner accepts `--project-config`, verifies the local container identity, clones schema into two independently owned random databases and removes each after its scenario. It preserves existing object grants but omits platform-owned default ACL statements during scratch restore. Synthetic policy acceptance exists only in those API-free disposable databases; focused SQL acceptance rolls back. The runner verifies the foundation policy remains byte-for-byte unchanged and each owned database is removed. No hosted writes or provider requests are made.

Renderer, exact byte capture and final transport guards belong to4800 and its companion runtime increment. Production schema5 remains gated on separate clinical acceptance; these tests do not record that acceptance.
