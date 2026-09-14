# Animal attachment original capture — implementation contract

Baseline: merged127 (`52b2ee4`), canonical86 migrations. Add7000 only; preserve6300/6500/6900. Planning is followed by implementation under the user's continue authorization. No hosted changes or provider-account reads in this increment.

## Outcome

An administrator explicitly captures one current Animal attachment observation into a separate private API-original ledger and can recover, inspect/download verified captured bytes, or discard an unfinished request. Captures are not patient_documents, manual-export receipts, clinical approvals or release sources. Keep metadata observations' file_sha256:null and metadata run capture_available:false; independent original captures have their own state.

Use a new private bucket `ezyvet-attachment-originals` (PDF/JPEG/PNG;20MiB). No public/direct object reads or overwrite. Worker upload uses the authenticated staff JWT and narrow Storage RLS checking the owned request/intent state; privileged readback follows explicit owner checks. Privileged deletion is allowed only after the owned immutable intent is fenced in discarding state; no browser SELECT/DELETE policy is granted. No service-role upload bypass. Stored object paths are server-generated and browser projections exclude them.

## Frozen browser contract

prepare_ezyvet_attachment_capture(p_id uuid,p_animal_link_id uuid,p_run_id uuid,p_page integer,p_ordinal integer,p_snapshot_id uuid,p_observed_head_version integer,p_stable_metadata_sha256 text) -> Capture.
recover_ezyvet_attachment_capture(p_id uuid,p_animal_link_id uuid) -> Capture|null.
list_ezyvet_attachment_captures(p_animal_link_id uuid,p_before_at timestamptz=null,p_before_id uuid=null,p_limit integer=20) -> {captures:Capture[],has_more:boolean,next_cursor:{before_at,before_id}|null}.

All browser RPCs require active administrator/auth.uid ownership. Exact preparation replay recovers existing owned intent before mutable source eligibility; conflicting input under an existing UUID rejects. New prepare validates immutable run/page/ordinal, expected snapshot/head/stable hash and frozen run parent against current mapping/client/patient/source. Server derives all IDs/metadata; browser supplies no URL, file bytes or claimed byte hash. Cursor pair bothnull/bothvalid, limit1–50.

Capture exact fields:
`id,requested_by,animal_link_id,pet_id,client_id,run_id,page,ordinal,snapshot_id,observed_head_version,external_id,file_id,stable_metadata_sha256,raw_record_sha256,metadata,parent_context,request_hash,status,source_current,lease_active,retry_after,last_error_code,retryable,created_at,updated_at,capture`.
Parent_context and safe metadata shapes exactly as6900. status enum `prepared|reserved|ready|blocked|discarding|abandoned`. `retryable` describes whether a capture may be retried (not ready/blocked/discarding/abandoned and current source); retry_after and lease_active separately gate timing. capture is null until ready, otherwise exact `{id,request_id,entry_method:'ezyvet_api_attachment_original_v1',content_sha256,mime_type,file_size,capture_hash,captured_at}`. Ready recovery remains ready after source changes, with source_current:false. Never expose service lease, path, credentials or temporary URLs. Last_error_code is null or fixed uppercase safe code.

## Service contract and worker

One new Edge function `capture-ezyvet-attachment`; POST `{action:'capture'|'retrieve'|'discard',request_id}`. Same-origin/allowed-origin CORS, boundedJSON, active-admin bearer validation. Browser recover/list is provider-free. Ready capture retry and retrieve work with importer disabled; fresh source traffic uses existing staging-only configuration, explicit read-attachment allowlist, issued site and production-source opt-in. Validate configured source equals frozen source before OAuth. Keep default contact/animal scopes unchanged.

Service-only RPC names (all return private context with `request:Capture`, `lease_id,lease_until` nullable, and `intent` nullable):
- get_ezyvet_attachment_capture_context(p_id uuid,p_actor uuid)
- claim_ezyvet_attachment_capture(p_id uuid,p_actor uuid)
- reserve_ezyvet_attachment_original(p_id uuid,p_actor uuid,p_lease_id uuid,p_content_sha256 text,p_mime_type text,p_file_size integer,p_before_raw_sha256 text,p_after_raw_sha256 text) — immutable intent, verify source/current lease; exact replay returns sameintent.
- complete_ezyvet_attachment_capture(p_id uuid,p_actor uuid,p_lease_id uuid,p_intent_id uuid,p_content_sha256 text,p_mime_type text,p_file_size integer) — immutable receipt, Storage object identity/metadata, pinned intent and current source/final wallclock lease check. Exact receipt replay before currentness.
- fail_ezyvet_attachment_capture(p_id uuid,p_actor uuid,p_lease_id uuid,p_code text,p_retry_seconds integer,p_terminal boolean) — bounded safe errors/cooldown, append failure audit; releases only matching lease. Terminal failures mark blocked; reserved objects remain tracked until retry/discard.
- begin_discard_ezyvet_attachment_capture(p_id uuid,p_actor uuid) — fenced discarding state, invalidates lease; denies ready; exact abandoned recovers.
- complete_discard_ezyvet_attachment_capture(p_id uuid,p_actor uuid) — verify object absent then abandoned; no deleting request/evidence.

Private intent exact fields `{id,bucket_id,object_path,content_sha256,mime_type,file_size,before_raw_sha256,after_raw_sha256}`. One immutable intent per request. Request context includes frozen source via request.parent_context. No URL or raw provider JSON. Lease180seconds and final clock_timestamp checks after all lock waits. Serialize metadata and capture claims under the same source gate; both honor the other's active lease/cooldown. Preserve lock order request/run → mapping/patient/Animal head → source gate → attachment heads → Storage object. No locks across HTTP.

Fresh worker: claim → exact-ID canonical metadata read → bounded download → exact-ID canonical metadata read → compare both stable projections/IDs/parent against frozen observation → reserve verified byte hash/size/MIME → staff-JWT no-upsert upload → privileged readback/hash verification → complete. Preserve before/after raw hashes independently; URL renewal is not a mismatch. The metadata reads use documented GET/v1/attachment with id/record_type/record_id/page=1/limit=10 and canonical parser; require exactly one matching observation and complete pagination. Download GET/v1/attachment/download/:id uses attachmentID and bearer auth, never file_id/download URL.

On reserved retry, claim and inspect the existing private object before provider fetch. If present, bounded-read/rehash and complete under current source/lease without another provider read. If absent, re-download using same pinned source checks and require bytes match immutable intent; never overwrite same-key different bytes. Lost complete response recovers immutable ready receipt before another read. Unknown upload response inspects expected owned path first. Storage missing is distinct from denied/unavailable; do not treat arbitrary failure as absence.

Retrieve: get owned ready context, download private object, verify full bytes/hash/size/MIME and signatures, return attachment bytes with no-store/nosniff and safe filename. No provider/config activation; verify actor association each request. Browser rehashes against recovered receipt before creating a Blob download. No inline HTML/content execution.

Discard: fence request first, recheck the owned discarding context, then privileged-delete only its uncommitted immutable intent object, verify absence, finalize abandoned. Upload Storage RLS locks/checks request and reserved intent so stale uploads cannot create an accessible object after fencing. Pending failures recover same discard state; never delete captured objects or unrelated paths. Test discard/upload/finalize ordering and delayed storage operations.

## Byte transport

Reuse strict documented-origin/bearer/deadline controls and proven signature/hash helpers where suitable. Exact200, reject redirects, partial/range and nonidentity encoding. Reject mismatched content length, unsupported/signature-mismatched files, >20MiB, zero/truncated originals. Download may advertise octet-stream; identify PDF/JPEG/PNG by byte signature and require consistent specific MIME when supplied. Bound allocation overhead (fixed buffer/slabs), not just sum of chunk bytes. Normalize retry delays to bounded integer seconds. Fixed errors do not include URLs/upstream bodies. No automatic retry of partially received originals.

## Ownership and verification

DB worker:7000, SQL/concurrency and restore fixtures/evidence, future87 inventory helpers. Runtime worker: adapter exact-ID/download extension, bounded byte module, new Edge handler/index, unit/nativeHTTP tests. UI worker: pure capture-state schemas/API, dedicated capture/history component and metadata UI integration, browser tests. Root: frozen contract, actual HTTP/Auth/Storage acceptance runner, CI wiring, integration, documentation and PR.

Required: hostile IDs/JSON/null/source substitution; owned RPCs/direct RLS denial; rawURL renewal; stable/byte changes; lost prepare/upload/complete/discard replies; cursor/pointer recovery; role changes; same-size Storage tampering; no-upsert; metadata/capture leases and parent changes both lock orders; lease expiry after waits; pending and ready restore; existing workflows regression. Use synthetic source only, isolated generated local stacks with verified cleanup. No provider samples or clinical readiness claims.
