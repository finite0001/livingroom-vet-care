# Reviewed API-original release contract

Schema 9 extends schema 8. Existing schemas 1–8 retain their original rendering, confirmation and captured-payload recovery behavior. Clinical policy 9 starts unaccepted; this work does not authorize a hosted launch or provider delivery.

## Selection and evidence

- Add `selection.api_original_ids` (at most 20 distinct admitted record UUIDs) and `snapshot.api_originals` in deterministic selected-ID order.
- Each entry is `{record, acknowledgment}`. `record` is the exact immutable migration-7100 review-record projection. `acknowledgment` is the earliest matching acknowledgment ordered by `(created_at,id)`, including its record and capture hashes. A matching DVM acknowledgment is required for this new source family. Additional acknowledgments do not change an already frozen entry.
- Fresh selection requires the latest nonwithdrawn record for its source series, matching patient, current household and mapping, and the exact ready private capture and Storage object. A later provider metadata/Animal-head refresh alone does not invalidate an admitted historical original.
- Replacement, withdrawal, or changed household/mapping invalidates pending delivery. Issued snapshots and previously captured payloads remain immutable. Captured-payload recovery precedes mutable eligibility checks; fresh capture, queue/send and public access must enforce eligibility.
- Add `preview_record_release_v9`, `list_record_release_sources_v9`, and `select_all_record_release_sources_v9` with existing arguments; confirmation arguments stay unchanged. API-only packages normalize all older empty selection families before composing prior preview logic.
- Candidate fields: `id`, `version`, `version_hash` (record hash), `recorded_at`, `label`, `source_label`, `mime_type`, `file_size`, `capture_hash`, `content_sha256`, `acknowledgment_count`, and `historical_source`. Add `policy_v9_accepted` and matching pagination field. Selection limits raise errors rather than silently truncating.

## Transport

- Keep these originals distinct from `patient_documents`. Append API-original files after ordinary attachment files. Combined maximum is 24 originals plus the report, within the existing 32 MiB encoded payload budget.
- A new document-link artifact has exactly `{filename,mime_type,document_id:null,api_original_id,content}`. Old artifact shapes stay unchanged. Email files retain their existing payload shape and bind by deterministic position and filename.
- API filenames are `N-ezyvet-original-SOURCE_ATTACHMENT_ID.ext`, where `N` is the one-based original-file index across ordinary attachments followed by API originals; extension follows verified MIME.
- `get_release_api_original_context(p_family text,p_id uuid,p_actor_id uuid,p_record_id uuid)` is service-only. Family is `release_email` or `document_link`; ID identifies the prepared delivery request/grant. It derives the authorized actor, release and frozen record itself and returns `{record_id,record_hash,capture_hash,content_sha256,mime_type,file_size,bucket_id,object_path,storage_object_id}`.
- Private locators never enter staff snapshots or public metadata. Native HTTP downloads require exact 200, no redirects, a deadline, streaming size enforcement (20 MiB maximum), MIME/signature/size/SHA verification, and context revalidation after reading. SQL capture independently validates every decoded file against frozen evidence and rejects extra, missing, reordered or substituted originals.
- Rendering identifies imported provenance, admission, exact DVM acknowledgment, file identity and checksum without adding clinical interpretation.

## Concurrency and verification

Patient advisory gate 4700 precedes ordered mapping/patient locks, ordered review-series gates 7101 and Storage locks. Migration-7100 mutation cores acquire the patient gate after exact recovery/abandon branches and before mutable locks. Do not acquire the patient gate from a post-write invalidation trigger while already holding series locks.

Verify API-only and mixed packages, missing/changed acknowledgment evidence, replacement/withdrawal/household races, historical source refresh, exact bytes and aggregate limits, capture recovery, both delivery channels, prior schema compatibility, staff UI selection and unaccepted-policy behavior. All provider delivery remains stubbed/local.
