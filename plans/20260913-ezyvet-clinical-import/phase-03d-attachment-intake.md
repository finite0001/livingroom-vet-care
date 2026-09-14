# Phase 3d — Animal-scoped attachment metadata intake

Status: the [bounded metadata parser](../../docs/features/ezyvet-attachment-metadata.md), durable run/page/observation ledgers, dedicated metadata dispatch and operator UI are implemented in this increment, pending final integrated acceptance. Original-file capture remains subsequent work. No hosted source-scope expansion or provider download is enabled. Living Room Vet remains primary and ezyVet access remains read-only.

## Outcome and boundary

An active administrator can start, resume and inspect an attachment metadata scan for one approved ezyVet Animal mapping. Durable observations identify discovered files and source revisions without claiming the files have been downloaded, reviewed, migrated or released. Unknown responses recover the existing run before retry. This is the smallest next increment toward the original-file migration required by Phase 3.

Consult and Contact parents are excluded from this increment. Contact attachments cannot be assumed to belong to every household pet. Consult support needs a separate same-site consult snapshot/hash/head-version contract. No native chart approval, new Storage object, document release, reminder, charge or source write results from metadata discovery.

## Verified primary contract and remaining uncertainty

Refreshed September 13, 2026 from the public [Attachment operation](https://developers.ezyvet.com/#get-attachment): GET `/v1/attachment`, OAuth `read-attachment`, `record_type` and `record_id` query filters, `items[].attachment` records, and pagination metadata. Preserve documented attachment identity, file reference, parent, timestamps, active status, MIME, name, primary-image flag and notes without interpreting clinical content. See the [source contract evidence](research/source-contracts.md#attachment-contract-refresh--september-13-2026).

The official [ezyVet Postman collection](https://developers.ezyvet.com/ezyvet-api.postman_collection.json) documents GET `/v1/attachment/download/:id`, using the attachment ID and bearer authorization. The route can be constructed without following a returned download URL. Redirect behavior, bounded content handling and authorized practice sample acceptance remain to be verified before capture is commissioned. No authorized practice attachment sample has been used; a new private API registration is not implied.

The provider's general pagination parameters have now been refreshed against the [official paging guide](https://developers.ezyvet.com/#paging); the parser uses an application page cap of 10 and validates all four documented cursor fields. It accepts a smaller advertised effective page size within that cap and verifies count/totals arithmetic against that size. No actual practice partial/empty-page sample has been accepted. Network dispatch remains disabled until durable scoped staging exists. Never label the application cap a documented provider maximum; reject oversized or inconsistent pages rather than silently truncating them.

## Parent identity and authorization

- Resolve the approved mapping on the server from `animal_link_id`; derive the source origin, issued site and external Animal ID there. Accept no caller-supplied host, site override, external parent ID or URL.
- Freeze mapping ID, patient ID, source identity and current mapping/source evidence in the run. Revalidate mapping eligibility when claiming or staging each page. Reuse current importer authorization and lock ordering; do not hold database locks across HTTP calls.
- Request the exact Animal parent filters. Every returned attachment must have the expected Animal type and canonical parent ID. Reject the entire page on a mismatch; never stage the valid subset and advance the checkpoint.
- Preserve source IDs as canonical strings using existing safe integer/string validation. Reject missing attachment/file/parent identity and invalid envelopes. Preserve unknown clinical metadata values explicitly; do not invent dates or convert source flags into clinical approval.
- Keep ledgers private under RLS, with no broad direct API grants. Staff-safe read RPCs require active authorization and patient access; run mutations/recovery bind the authenticated actor. Service staging requires the claimed actor and valid lease.

## URL handling and observation identity

`file_download_url` may be a signed or expiring capability. Do not expose it in staff projections, audit payloads, application logs, error responses or source fixtures committed to Git. Do not feed it into the generic raw snapshot table until its read/audit paths have been audited for exposure. Metadata intake must never fetch this URL.

For this increment, retain a documented safe projection of source metadata and a SHA-256 of the observed raw response record; discard the raw URL after parsing. Label the projection as sanitized, not an exact raw source snapshot. Maintain a separate stable metadata fingerprint excluding the URL so URL rotation alone does not imply a clinical change. Record observations even when the stable metadata is unchanged; do not overwrite earlier evidence. Store neither credentials nor the URL itself. Later capture must obtain a fresh provider reference and revalidate attachment/file/parent identity before fetching.

A file ID or stable metadata hash does not prove byte identity. Byte checksum remains unavailable until a later verified capture; do not synthesize it from metadata or equate equal metadata with equal originals.

## Durable runs, pages and recovery

Use existing clinical/vaccination run and lease patterns, extended with a distinct attachment contract. Add an additive migration; reserve its version against the latest integration branch before implementation.

The run records its UUID, actor, approved mapping/patient, source origin/site, `attachment` resource, fixed Animal parent, contract version, state, expected next page, current lease, safe failure code, cooldown/retry timing and timestamps. Exact repeated claim arguments recover the original run; changed arguments under the same UUID conflict. Recovery and server discovery of unfinished runs work independently of browser storage.

Each committed page records run/page identity, request contract fingerprint, observed item count, provider pagination evidence, safe page digest and observation time. Each item observation records attachment ID, file ID, parent, sanitized metadata, raw-record digest, stable metadata fingerprint and source-head version. Observation order and membership are durable. Shared source identity includes origin/site/resource/ID; the run's parent binding is checked in addition to that identity.

Stage the complete validated page and advance its checkpoint in one transaction under a current lease. Exact committed-page replay recovers its receipt; different content under that committed page does not replace it. An uncertain stage response requires receipt/checkpoint recovery before a new provider fetch. Expired leases cannot commit. Rate limits reuse shared provider cooldowns and bounded retry, with no competing scan for the same active scope.

Track separate observed and uniquely staged counts; retain duplicates and changed observations as reconciliation evidence. Completion means the observed pagination ended, not a consistent full export. Never interpret an absent item/page as deletion. Inconsistent page metadata, parent drift, source changes and failed pages leave explicit unresolved status. Failed or interrupted runs remain discoverable and resumable or explicitly abandoned without deleting observations.

## Operator surface

Add a clearly labeled “Attachment metadata” section to the existing import workflow, showing the approved Animal source, safe file metadata, run state, checkpoint and recoverable errors. Show discovered files separately from captured originals; this increment has no captured-file action. Do not display download links. Account changes and signout clear the active browser view and invalidate late responses. Retained request references are scoped to actor and mapping and cannot cross accounts; authorized server discovery also survives browser pointer loss.

## Later original-byte capture requirements

Before enabling capture, verify supported download behavior with current primary documentation and a bounded authorized sample, without printing source URLs, bytes or credentials. Define an explicit permitted destination and redirect policy; never forward OAuth credentials across arbitrary redirects. Enforce timeout, bounded streaming, permitted content types and PDF/JPEG/PNG signature checks. The current private document bucket permits those formats up to 20 MiB; larger or unsupported files need an explicit unresolved outcome, not silent loss.

Create distinct API provenance bound to the observed attachment/file/parent revision and actual SHA-256. Reuse document reservation, private Storage and immutable capture/recovery patterns where their contracts match. The manual-original RPCs constrain `staff_reviewed_manual_export_v1`; do not relabel an API file through them. Handle partial uploads, duplicate retries, unknown upload/capture acknowledgments and owned-object cleanup durably. Revalidate source identity around capture; a changed source creates a new observation/review requirement rather than silently replacing bytes.

Subsequent work includes explicit staff review, DVM acknowledgment where required, immutable release projection/invalidation, both delivery paths, checksum-preserving restore and whole-migration reconciliation. Metadata intake does not complete any of those gates.

## Owned implementation areas and verification

1. `supabase/functions/ezyvet-import/adapter.ts` and `handler.ts`: explicit attachment schema, parent-filter construction and dispatch; never arbitrary URLs. Preserve default `contact,animal` configuration. Test parent/site substitution, URL redaction, URL-only rotation, size bounds, malformed envelopes, cooldown and lost acknowledgments.
2. Additive SQL migration and `tests/ezyvet/`: scoped run/page/observation RPCs and staff projections. Test role/actor isolation, stale mappings, lease races, duplicate/different page replay, atomic page rejection, durable recovery and source revision/reversion. Inspect grants and audit output for URL exposure.
3. `src/hub/features/imports/` and focused browser cases: start/resume/server discovery, safe metadata display, interrupted/retried requests, account changes and stale-response cleanup. Confirm no capture/approval/release action appears.
4. Real local Auth/PostgREST harness with synthetic source responses: assert exact run/checkpoint behavior and zero Storage objects, outgoing messages or native clinical writes. Add populated upgrade/restore coverage for the new ledgers and exact grants.

Run relevant unit, SQL, contention, browser and frozen Edge entrypoint checks. Keep source commissioning disabled until authorized sample acceptance; do not expand hosted scopes or call the live provider as a side effect of these checks. Record deployment, source acceptance and clinical acceptance separately from implementation status.

## Integrated acceptance evidence

Pending final integration verification. Add the exact integrated revision, SQL/contention, browser, actual local Auth/PostgREST and populated restore results here after they pass. Do not infer hosted deployment, provider sample acceptance or clinical approval from local implementation.
