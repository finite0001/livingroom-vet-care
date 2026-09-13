# Reviewed outside vaccinations — 5300 frozen contract

All RPCs return JSONB. Prepare/approve/recover/abandon/list requests and candidate reads require active DVM. Chart read requires active staff. Direct tables/private helpers revoked from all API roles. All dates below are date-only strings, never timestamps.

## Public RPCs

- `list_ezyvet_vaccination_review_mappings(p_pet_id uuid)` returns DVM-readable JSON array `[{link_id,pet_id,source_origin,source_site_uid,external_id,patient_version}]`, restricted to matching current household; rejects over50 mappings.

- `list_ezyvet_vaccination_review_candidates(p_pet_id uuid,p_animal_link_id uuid,p_before_at timestamptz=null,p_before_id uuid=null,p_limit integer=20)` returns same candidate envelope/fields as 5200, with exact patient filter; ADMIN intake remains unchanged.
- `prepare_ezyvet_vaccination_review(p_id uuid,p_pet_id uuid,p_payload jsonb)`
- `approve_ezyvet_vaccination_review(p_id uuid,p_pet_id uuid,p_expected_hash text,p_confirmed boolean)`
- `recover_ezyvet_vaccination_review(p_id uuid,p_pet_id uuid)`
- `abandon_ezyvet_vaccination_review(p_id uuid,p_pet_id uuid,p_confirmed boolean)`
- `list_ezyvet_vaccination_review_requests(p_pet_id uuid,p_before_at timestamptz=null,p_before_id uuid=null,p_limit integer=20)` returns `{requests:[operation],has_more,next_cursor}`.
- `list_patient_imported_vaccinations(p_pet_id uuid,p_before_at timestamptz=null,p_before_id uuid=null,p_limit integer=20)` returns `{vaccinations:[projection],has_more,next_cursor}` including all immutable versions; use `current.is_latest` to distinguish superseded versions.

All cursors descending created_at/id for requests, approved_at/id for chart. Same `{before_at,before_id}` cursor fields. Recover absent => null. Other operation RPCs return `{request,receipt}`. Request has `id,actor_id,pet_id,status,payload,request_hash,review_context,created_at,resolved_at,approved_record_id`; status prepared/approved/abandoned. Tombstone fields payload/hash/context/approved_record_id null. Receipt null except approved. Identical source review across UUIDs links existing receipt through approved_record_id.

## Exact prepare payload

Every key required, nullable keys explicitly JSON null, no extra keys:

```
{
 animal_link_id: UUID, patient_version: positive integer,
 snapshot_id: UUID, payload_hash: lowercase SHA256, observed_head_version: positive integer,
 consult_snapshot_id: UUID, consult_payload_hash: lowercase SHA256, consult_observed_head_version: positive integer,
 product_id: UUID|null, product_version: positive integer|null,
 administered_on: YYYY-MM-DD|null, administration_date_status: "date"|"unknown"|"uninterpreted",
 source_next_due_on: YYYY-MM-DD|null, next_date_status: "date"|"unknown"|"uninterpreted",
 status: "administered"|"not_administered"|"unknown",
 outside_author: string|null,
 reason: string,
 replaces_id: UUID|null, expected_predecessor_hash: lowercase SHA256|null
}
```

Date status date iff corresponding date non-null; dates real finite ISO dates. Product pair both null or both set; active current catalog vaccine product/version validated. Outside author nullable nonblank up to500 chars; reason trimmed length5–2000. Null remains unknown. Status is explicit interpretation independent of raw active. No dose/route/lot/manufacturer inference. Corrections require predecessor pair and rationale (reason), source identity must match latest predecessor. Same exact source/context/product/reviewed interpretation returns existing receipt regardless of actor/reason; changed evidence or interpretation requires predecessor. Prepare freezes full identity, raw original and catalog snapshot. Approval revalidates for new commit. Exact terminal recovery preserves receipt after eligibility/source changes but always requires current original DVM.

## Approved projection / release helper contract

`ezyvet_imported_vaccination_projection(p_id uuid)` private helper returns:

```
{
 id,pet_id,animal_link_id,client_id,version,version_hash,
 source:{origin,site_uid,animal_id,vaccination_id},
 snapshot_id,payload_hash,observed_head_version,
 original: {raw vaccination payload},
 consult:{snapshot_id,payload_hash,observed_head_version,external_id},
 reviewed:{administered_on,administration_date_status,source_next_due_on,next_date_status,status,outside_author},
 product: null|{id,version,name,kind},
 reason,replaces_id,expected_predecessor_hash,approved_by,approved_at,
 current:{is_current,is_latest,snapshot_id,head_version,consult_snapshot_id,consult_head_version,identity_valid},
 correction_history:[{id,version,version_hash,replaces_id,reason,approved_by,approved_at}]
}
```

Private `ezyvet_vaccination_current(p_id uuid)` supplies current object. Table `ezyvet_imported_vaccinations` stores corresponding scalar identity/source/pins plus original,consult,reviewed,product,reason,replaces_id,expected_predecessor_hash,approved_by/at and `interpretation_hash`. Unique source identity/version and one successor/predecessor. Private `ezyvet_validate_reviewed_vaccinations(p_pet_id uuid,p_sources jsonb)` accepts 1–20 distinct `{id,version_hash}` and returns projections after SHARE locks mapping/patient then canonical consult/vaccination heads; requires exact patient, current/latest/identity valid. Release owner may call helpers from SECURITY DEFINER, never grant helper RPC execution.

No native treatment, stock, billing, due plan, certificate, reminder or outbox side effects.

## Review context and locking

Request review_context keys are pet_id,client_id,animal_link_id,source,snapshot_id,payload_hash,observed_head_version,original,consult,reviewed,product, using the approved projection shapes above. It excludes rationale and correction pointers, which remain in the frozen payload. interpretation_hash covers this context; approval version_hash additionally covers frozen payload (including rationale and predecessor hash), actor, timestamp and operation UUID.

Lock order: operation advisory5300 → patient advisory4700 → mapping SHARE → patient SHARE → consult head SHARE → vaccination head SHARE → optional catalog SHARE. Patient4700 serializes every valid approval for the immutable animal mapping/source identity, including different clinicians and UUIDs. It is shared with record-release workflows. Source ingestion does not acquire4700; compatible mapping/patient reads precede canonical source-head writes. Release validation acquires4700 then ordered mapping SHARE, patient SHARE and canonical source-head SHARE. No approved row is overwritten. Mapping identity cannot be rebound through API roles.

Current read projections retain approved original/interpretation and report changed source revisions separately. Only current, latest, same-patient versions can enter a newly prepared record release. Existing approved operations still recover their original record identity after source changes; dynamic current/correction-history projections can reflect newer evidence.
