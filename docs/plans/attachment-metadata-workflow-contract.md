# Attachment metadata workflow — implementation contract

Base: merged125 (`abb86f1`). Animal-only, no file download or capture. Preserve canonical6300 and6500. New metadata migration is reserved at `20260913690000`; PR126's incompatible6500 and deferred6600–6800 are not applied.

## Service operations

`claim_ezyvet_attachment_import(p_id uuid,p_actor uuid,p_site_uid text,p_source_origin text,p_animal_link_id uuid)` returns the generic run plus `animal_external_id`, `animal_link_id`, `pet_id`, `client_id`, frozen `parent_context` and service-only `lease_id`. Server derives the current Animal snapshot/hash/head version from the approved mapping on first claim; no caller-supplied external parent or source override. Exact run identity includes actor, mapping, source and fixed Animal scope. Fresh claims/pages revalidate the frozen parent and patient membership. Terminal recovery does not require current source evidence.

`stage_ezyvet_attachment_page(p_run_id uuid,p_actor uuid,p_lease_id uuid,p_page jsonb)` accepts only canonical `parseAttachmentMetadataPage` output. Validate contract, parent, IDs, metadata allowlist/types/limits, hash formats, ordinal observations and cursor/count consistency again. No URL/unknown metadata key is permitted. Service-authenticated parser hashes attest its observed canonical input, not original file bytes; database-generated snapshot hashes/currentness use the stored safe projection. Preserve raw-record and stable metadata hashes in immutable ordered observation rows and page hash/pagination in immutable page receipts.

Stable snapshots contain only the metadata projection plus `representation:'sanitized_attachment_metadata_v1'`; raw-record digests belong to observation rows, so URL-only renewal cannot advance a stable metadata head. Identical repeated IDs within a page retain all observations but stage one stable snapshot. Conflicting metadata for one ID in the same page rejects the entire page and leaves the checkpoint unchanged. Cross-page revisions remain visible. Explicit counts distinguish observations from distinct staged snapshot versions.

Reuse the generic run/core lease/cooldown mechanisms behind narrow service RPCs; public generic claim/stage must reject attachment bypasses. Preserve exact committed-page recovery before mutable source/lease checks. Fresh stage locks the run, approved mapping/patient/parent and every relevant attachment head in canonical order, then rechecks lease validity with wall-clock time after waits immediately before staging. No competing scan/cooldown bypass; stale workers cannot commit. Import failure uses existing restricted fail RPC and safe codes. No native clinical, invoice, outbox or Storage write.

## Browser operations

Reuse `search_ezyvet_mapped_patients` for mapping selection. All new browser RPCs require active administrator identity and bind ownership via `auth.uid()`.

- `recover_ezyvet_attachment_run(p_id uuid,p_animal_link_id uuid)` -> Run or null.
- `list_ezyvet_attachment_runs(p_animal_link_id uuid,p_before_at timestamptz=null,p_before_id uuid=null,p_limit integer=20)` -> `{runs:Run[],has_more,next_cursor:{before_at,before_id}|null}`.
- `list_ezyvet_attachment_observations(p_run_id uuid,p_animal_link_id uuid,p_after_page integer=null,p_after_ordinal integer=null,p_limit integer=20)` -> `{observations:Observation[],has_more,next_cursor:{after_page,after_ordinal}|null}`.

Run: `id,requested_by,resource:'attachment',source_origin,source_site_uid,status,next_page,retry_after,last_error_code,created_at,updated_at,lease_active,scope:'animal_attachment_metadata',parent_context,observed_count,staged_count,capture_available:false`. Status uses existing `running|review_ready|page_limit_reached`. Parent context: `animal_link_id,pet_id,client_id,animal_external_id,source_origin,source_site_uid,parent_type:'Animal',parent_external_id,parent_snapshot_id,parent_payload_hash,parent_observed_head_version`.

Observation: `run_id,page,ordinal,external_id,file_id,metadata,raw_record_sha256,stable_metadata_sha256,snapshot_id,observed_head_version,is_current,created_at,file_sha256:null`. Metadata is the parser's exact safe projection; no URL or raw payload. Ordinals start at1. Cursor pairs are both null or both valid; limits1–50. Expose no service lease token. Currentness compares snapshot/head and frozen parent/membership; old observations remain readable when stale.

## Edge/browser behavior

POST ezyvet-import: `{run_id,resource:'attachment',animal_link_id}`. Existing authentication/origin/configuration boundaries apply. Default read scopes remain contact/animal; explicit attachment scope is needed for commissioning. Claim derives the external Animal ID, then dedicated adapter metadata read constructs `/v1/attachment?page=N&limit=10&record_type=Animal&record_id=ID`. Reuse bounded OAuth/retry/redirect controls; parse only with the canonical attachment parser. Never use generic `parsePage`/`adapter.page` for attachments. Stage through the dedicated RPC. Success uses existing `{run_id,status,next_page,complete}` response; the UI reloads authoritative run/observations.

Add an admin-only Attachment metadata tab/panel alongside the existing import workflows. Start/resume/discover runs, display source/patient binding, explicit observed/staged counts and safe ordered metadata; show stale observations and recoverable failures. Recover uncertain responses before fetching another page. Preserve owned UUID across lost replies; server discovery survives browser pointer loss. Discard late responses on mapping/account change and signout. Never show download/approval/release actions; completion means only observed metadata pages ended.

## Verification

Require SQL role/actor/site/parent/private-grant and exact replay tests, source/lease contention including expiry during lock waits, bounded adapter/handler tests, browser recovery/navigation/pagination tests, actual local Auth/PostgREST roundtrip with no Storage/clinical/outbox side effects, and populated upgrade/restore of new receipts with exact canonical permissions. Keep hosted scopes/import mode and sending unchanged. Clinical/source sample acceptance remains separate.
