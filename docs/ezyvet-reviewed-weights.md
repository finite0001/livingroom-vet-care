# Reviewed ezyVet historical weights

This slice promotes explicitly reviewed historical weights into the Living Room Vet patient chart. Source fetching remains disabled by default. No live ezyVet requests, issued credentials, production deployments, or clinical approvals were performed during implementation.

## Review flow

1. An active administrator finds a patient through a previously reviewed ezyVet animal mapping. Search is bounded and the selected patient remains selected when the search changes.
2. The authenticated Edge function derives the source animal ID from that mapping, verifies its source host/site against server configuration, and fetches one bounded health-status page. Browsers cannot supply an arbitrary source animal ID. Imported observations remain immutable staging snapshots.
3. Select the current observation. Review patient identity, possible duplicates, weight, unit, and original measurement date. Only recognized `kg` and `lb` units receive suggestions. Unknown units and invalid or missing timestamps require explicit review. Valid epoch timestamps suggest the calendar date in America/Denver; the reviewer must independently verify the original date. Inactive source observations cannot create or link weights.
4. Prepare the exact proposed action on the server, then explicitly approve it. Either create a dated historical measurement or link an existing measurement with exactly the same patient/value/unit/date. No existing weight is overwritten. Source identities can be approved only once, even when a later source correction is observed.
5. A changed source snapshot requires a separate authored discrepancy review. That review retains the existing chart weight. It does not silently replace a measurement, modify a signed encounter, or invent a source clinician's signature.

Chart history includes the approved original source record number, weight/unit, original timestamp, reviewing staff, and review time. The reviewer is identified as reviewer, not source clinician. Multiple explicit source links to the same local measurement are displayed. Source and request metadata are stored separately from `patient_weights`, so existing medical-release projections do not acquire raw integration fields.

## API contract and permissions

Migration: `20260913230000_reviewed_weight_import.sql`.

- `claim_ezyvet_weight_import(id, actor, site, origin, animal_link_id)` is service-only, validates the active administrator and reviewed patient mapping, then uses the existing durable run/lease machinery. It returns the server-derived animal ID. Generic claims cannot start `healthstatus` or the unsupported diagnostic collection.
- `stage_ezyvet_import_page` preserves existing page/cursor transactions and rejects any health-status observation for another animal.
- `search_ezyvet_weight_patients(search, limit)` and `list_ezyvet_weight_candidates(mapping, before_at, before_id, limit)` are active-administrator-only bounded lookups. Candidate pagination is stable by observation timestamp and UUID.
- `prepare_ezyvet_weight_request(request_id, snapshot_id, payload)` records an actor-owned immutable exact action snapshot without creating a weight. Only one unresolved preparation is allowed per actor/source snapshot. Payload size is capped at 10 kB.
- `approve_ezyvet_weight` requires the same prepared UUID/payload, authenticated actor, selected current source hash/head version, reviewed mapping, unchanged patient version, explicit confirmation and reason. The source identity lock and unique approval key prevent concurrent duplicates. Exact retries return the original receipt; different payloads fail.
- `resolve_ezyvet_weight_request(request_id, snapshot_id, discard)` acknowledges an already committed approval or explicitly abandons a preparation. If preparation never committed, it records a tombstone under the same advisory lock. Late requests cannot revive an abandoned UUID.
- `review_ezyvet_weight_change` appends an actor-attributed, UUID-idempotent discrepancy review against the current source head. Previous approvals and chart rows are retained.
- `read_weight_import_provenance(pet_id, weight_ids)` permits active clinical staff to read an explicit safe source projection for at most 50 requested patient measurements. It does not expose arbitrary source payloads, credentials, or another patient's rows. The chart loads measurements in keyset pages of 50.

Preparation rows are readable only by their active administrator owner. Staging and review ledgers are administrator-only; clinical staff receive only the chart-safe projection. Direct writes are revoked. Source/run/approval/review history has immutable update/delete guards. Private renamed claim/stage cores are not executable by API roles.

## Recovery and account boundaries

Session storage contains only opaque run/request UUIDs under actor and mapping/source-snapshot scopes. It contains no measurement values, contact details, or review text. Reloading or returning to the selected source retrieves the authorized server snapshot and receipt. Recovery never auto-approves. A lost preparation response offers recheck or explicit abandonment; a committed preparation offers approval of its exact saved payload; a lost approval response offers acknowledgment of the completed receipt.

Changing patient selection cannot reuse the previous patient's request. Account switching changes all query/pointer scopes; server ownership checks independently reject another actor. Signing out prevents authenticated recovery until that administrator signs in again. Prepared server snapshots remain for audit. Two tabs attempting different unresolved preparations for the same actor/source snapshot receive a conflict instead of independent approvals. A browser without its opaque pointer cannot automatically discover an earlier request; administrator database-assisted recovery remains an operational fallback. Source discrepancy reviews are durable and displayed from the server; their uncertain response can be rechecked by reopening the observation.

## Verified public documentation and commissioning gates

Reviewed September 12, 2026 using the official [API reference](https://developers.ezyvet.com/), [release notes](https://developers.ezyvet.com/release-notes.html), and [filtering guide](https://developers.ezyvet.com/guides/api-filtering.html):

- Animal collection fetching now uses documented `GET /v2/animal`; deprecated v1 animal GET is no longer used.
- Weight observations use documented `GET /v1/healthstatus` with required `animal_id`, the `healthstatus` item wrapper, and `weight`, `weight_unit`, `timestamp`, `animal_id`, and `active`. The adapter requests at most 10 observations per page.
- `GET /v1/diagnostic` requires an identifier and represents a diagnostic test definition. It is removed from selectable/configurable collection resources; historical staging rows remain readable. It is not a lab-result import feature.

Before commissioning, obtain the practice's approved ezyVet integration, issued read scopes/site credentials, actual sandbox contract verification, and Dr. Susan Edler's clinical review of unit/date and duplicate handling. The [private integration guidance](https://www.ezyvet.com/build-a-custom-integration) describes restrictions on SMS/payment frameworks; obtain written vendor confirmation that the intended read-only migration into Living Room Vet's independently operated communication/payment system is permitted. These are explicit unresolved gates, not claims of provider approval.

Keep `EZYVET_IMPORT_MODE` disabled until commissioned. The enabled mode remains staging-only and requires `healthstatus` in approved read resources. Production-source reads additionally require the existing explicit opt-in. No clinical imports beyond historical weight, SOAP conversion, vaccine certification from source claims, diagnosis promotion, lab integration, attachments, write-back, or automatic backfill are implemented here.

## Verification

Synthetic adapter/handler tests cover animal v2 routing, mapped patient health-status filtering, wrong-patient rejection, unknown values, and page bounds. SQL tests cover permissions, leases, exact preparation, duplicate prevention, source/patient conflicts, create/link semantics, immutable approvals, tombstones, source corrections, and clinical-staff provenance. Browser tests cover unknown-value review, retained patient selection, recovery after lost preparation/approval responses, and persisted chart provenance. All provider traffic in tests is mocked.
