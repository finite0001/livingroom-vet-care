# Phase 3d — Animal-scoped attachment metadata intake

Status: the [bounded metadata parser](../../docs/features/ezyvet-attachment-metadata.md), durable run/page/observation ledgers, dedicated metadata dispatch and operator UI are implemented and verified in merged [PR127](https://github.com/finite0001/livingroom-vet-care/pull/127). The separate [original-capture workflow](../../docs/features/ezyvet-attachment-originals.md) is implemented, with local integrated acceptance complete under its [frozen contract](../../docs/plans/attachment-original-capture-contract.md). No hosted source-scope expansion or practice-provider commissioning is enabled. Living Room Vet remains primary and ezyVet access remains read-only.

## Outcome and boundary

An active administrator can start, resume and inspect an attachment metadata scan for one approved ezyVet Animal mapping. Durable observations identify discovered files and source revisions without claiming the files have been downloaded, reviewed, migrated or released. Unknown responses recover the existing run before retry. This is the smallest next increment toward the original-file migration required by Phase 3.

Consult and Contact parents are excluded from this increment. Contact attachments cannot be assumed to belong to every household pet. Consult support needs a separate same-site consult snapshot/hash/head-version contract. No native chart approval, new Storage object, document release, reminder, charge or source write results from metadata discovery.

## Verified primary contract and remaining uncertainty

Refreshed September 13, 2026 from the public [Attachment operation](https://developers.ezyvet.com/#get-attachment): GET `/v1/attachment`, OAuth `read-attachment`, `record_type` and `record_id` query filters, `items[].attachment` records, and pagination metadata. Preserve documented attachment identity, file reference, parent, timestamps, active status, MIME, name, primary-image flag and notes without interpreting clinical content. See the [source contract evidence](research/source-contracts.md#attachment-contract-refresh--september-13-2026).

The official [ezyVet Postman collection](https://developers.ezyvet.com/ezyvet-api.postman_collection.json) documents GET `/v1/attachment/download/:id`, using the attachment ID and bearer authorization. The route can be constructed without following a returned download URL. Redirect behavior, bounded content handling and authorized practice sample acceptance remain to be verified before capture is commissioned. No authorized practice attachment sample has been used; a new private API registration is not implied.

The provider's general pagination parameters have now been refreshed against the [official paging guide](https://developers.ezyvet.com/#paging); the parser uses an application page cap of 10 and validates all four documented cursor fields. It accepts a smaller advertised effective page size within that cap and verifies count/totals arithmetic against that size. No actual practice partial/empty-page sample has been accepted. Dedicated metadata dispatch is implemented; hosted import mode and source scopes remain unchanged pending commissioning. Never label the application cap a documented provider maximum; reject oversized or inconsistent pages rather than silently truncating them.

## Parent identity and authorization

- Resolve the approved mapping on the server from `animal_link_id`; derive the source origin, issued site and external Animal ID there. Accept no caller-supplied host, site override, external parent ID or URL.
- Freeze mapping ID, patient ID, source identity and current mapping/source evidence in the run. Revalidate mapping eligibility when claiming or staging each page. Reuse current importer authorization and lock ordering; do not hold database locks across HTTP calls.
- Request the exact Animal parent filters. Every returned attachment must have the expected Animal type and canonical parent ID. Reject the entire page on a mismatch; never stage the valid subset and advance the checkpoint.
- Preserve source IDs as canonical strings using existing safe integer/string validation. Reject missing attachment/file/parent identity and invalid envelopes. Preserve unknown clinical metadata values explicitly; do not invent dates or convert source flags into clinical approval.
- Keep ledgers private under RLS, with no broad direct API grants. Staff-safe read RPCs require active authorization and patient access; run mutations/recovery bind the authenticated actor. Service staging requires the claimed actor and valid lease.

## URL handling and observation identity

`file_download_url` may be a signed or expiring capability. Do not expose it in staff projections, audit payloads, application logs, error responses or source fixtures committed to Git. Do not feed it into the generic raw snapshot table until its read/audit paths have been audited for exposure. Metadata intake must never fetch this URL.

For this increment, retain a documented safe projection of source metadata and a SHA-256 of the observed raw response record; discard the raw URL after parsing. Label the projection as sanitized, not an exact raw source snapshot. Maintain a separate stable metadata fingerprint excluding the URL so URL rotation alone does not imply a clinical change. Record observations even when the stable metadata is unchanged; do not overwrite earlier evidence. Store neither credentials nor the URL itself. Independent original capture obtains fresh exact-ID metadata and revalidates attachment/file/parent identity around fetching.

A file ID or stable metadata hash does not prove byte identity. Byte checksum remains unavailable in metadata observations; an independent verified capture supplies its own byte checksum. Do not synthesize it from metadata or equate equal metadata with equal originals.

## Durable runs, pages and recovery

Use existing clinical/vaccination run and lease patterns, extended with a distinct attachment contract. Add an additive migration; reserve its version against the latest integration branch before implementation.

The run records its UUID, actor, approved mapping/patient, source origin/site, `attachment` resource, fixed Animal parent, contract version, state, expected next page, current lease, safe failure code, cooldown/retry timing and timestamps. Exact repeated claim arguments recover the original run; changed arguments under the same UUID conflict. Recovery and server discovery of unfinished runs work independently of browser storage.

Each committed page records run/page identity, request contract fingerprint, observed item count, provider pagination evidence, safe page digest and observation time. Each item observation records attachment ID, file ID, parent, sanitized metadata, raw-record digest, stable metadata fingerprint and source-head version. Observation order and membership are durable. Shared source identity includes origin/site/resource/ID; the run's parent binding is checked in addition to that identity.

Stage the complete validated page and advance its checkpoint in one transaction under a current lease. Exact committed-page replay recovers its receipt; different content under that committed page does not replace it. An uncertain stage response requires receipt/checkpoint recovery before a new provider fetch. Expired leases cannot commit. Rate limits reuse shared provider cooldowns and bounded retry, with no competing scan for the same active scope.

Track separate observed and uniquely staged counts; retain duplicates and changed observations as reconciliation evidence. Completion means the observed pagination ended, not a consistent full export. Never interpret an absent item/page as deletion. Inconsistent page metadata, parent drift, source changes and failed pages leave explicit unresolved status. Failed or interrupted runs remain discoverable without deleting observations. Valid unchanged parent contexts can resume; changed contexts require a new scan.

## Operator surface

Add a clearly labeled “Attachment metadata” section to the existing import workflow, showing the approved Animal source, safe file metadata, run state, checkpoint and recoverable errors. Show discovered metadata separately from the independent original-capture panel. The metadata scan has no captured-file action or provider download link; the separate panel supports explicit capture, owned recovery and checksum-verified downloads. Account changes and signout clear the active browser view and invalidate late responses. Retained request references are scoped to actor and mapping and cannot cross accounts; authorized server discovery also survives browser pointer loss.

## Independent original capture and remaining requirements

The [original-capture workflow](../../docs/features/ezyvet-attachment-originals.md) implements the documented attachment-ID download route, exact source checks around fetching, bounded byte validation and immutable API provenance in a separate private `ezyvet-attachment-originals` bucket. The application accepts PDF/JPEG/PNG up to 20 MiB, rejects redirects and does not follow provider download URLs. Larger or unsupported files remain explicit unresolved outcomes. Local integrated acceptance is complete; actual practice source samples and commissioning remain separate gates.

Captures use `ezyvet_api_attachment_original_v1` and do not pass through `staff_reviewed_manual_export_v1` RPCs or become native `patient_documents`. Owned request recovery, historical mapping discovery, uncreated-request abandonment and fenced unfinished-object discard are specified in the [frozen capture contract](../../docs/plans/attachment-original-capture-contract.md). Metadata observations retain `file_sha256:null` and metadata runs retain `capture_available:false`.

The separate [API-original chart review workflow](../../docs/features/reviewed-api-originals.md) implements provenance admission, patient-chart history and exact DVM acknowledgment, with local acceptance complete. Subsequent work includes immutable release projection/invalidation, both delivery paths, Consult/Contact parent contracts and whole-migration reconciliation. Capture and metadata implementation do not complete those gates. The original-capture feature document records its own byte-preserving restore and integrated acceptance evidence; prior metadata-only evidence does not establish those results.

## Owned implementation areas and verification

1. `supabase/functions/ezyvet-import/adapter.ts` and `handler.ts`: explicit attachment schema, parent-filter construction and dispatch; never arbitrary URLs. Preserve default `contact,animal` configuration. Test parent/site substitution, URL redaction, URL-only rotation, size bounds, malformed envelopes, cooldown and lost acknowledgments.
2. Additive SQL migration and `tests/ezyvet/`: scoped run/page/observation RPCs and staff projections. Test role/actor isolation, stale mappings, lease races, duplicate/different page replay, atomic page rejection, durable recovery and source revision/reversion. Inspect grants and audit output for URL exposure.
3. `src/hub/features/imports/` and focused browser cases: start/resume/server discovery, safe metadata display, interrupted/retried requests, account changes and stale-response cleanup. Confirm metadata discovery creates no capture implicitly; the independent capture panel offers no clinical approval or release action.
4. Real local Auth/PostgREST harness with synthetic source responses: assert exact run/checkpoint behavior and zero Storage objects, outgoing messages or native clinical writes. Add populated upgrade/restore coverage for the new ledgers and exact grants.

Run relevant unit, SQL, contention, browser and frozen Edge entrypoint checks. Keep source commissioning disabled until authorized sample acceptance; do not expand hosted scopes or call the live provider as a side effect of these checks. Record deployment, source acceptance and clinical acceptance separately from implementation status.

## Integrated acceptance evidence

Locally verified: 490 unit tests, 256 browser cases, 2,648 SQL assertions, existing and attachment contention checks, 50 actual HTTP/Auth/PostgREST checks, frozen Edge checks and a populated51→86 upgrade/restore with matching permissions/RLS and verified cleanup. See the [feature validation and hash-bound receipts](../../docs/features/ezyvet-attachment-metadata.md#validation). No hosted deployment, provider sample acceptance or clinical approval is implied. Independent original-byte capture is implemented and tracked separately, with local integrated acceptance complete in its [feature document](../../docs/features/ezyvet-attachment-originals.md).
