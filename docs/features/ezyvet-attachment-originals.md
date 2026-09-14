# ezyVet attachment originals

Administrators can explicitly capture a current Animal attachment observation into a private API-original record, recover interrupted work, download verified bytes and discard unfinished requests. This builds on the metadata workflow in PR127. Local integrated HTTP/Storage, concurrency and populated restore acceptance is complete; hosted commissioning remains pending.

## Operator workflow

Select an approved Animal mapping in the attachment import area, inspect its metadata observations and choose an original to capture. The browser saves an immutable request reference before preparation and sends only that reference when asking the worker to capture, retrieve or discard. The server derives source identity, file identity and private paths from the frozen observation. New captures require current source and patient membership.

Saved captures have their own owner-only history. A separate historical mapping selector keeps older captures discoverable after a patient changes households and the former mapping no longer appears in current-patient search. That historical view offers original recovery, not a new metadata scan. Ready captures remain ready after source changes and display stale-source status.

A preparation that never created a record can be explicitly abandoned through a scoped server tombstone. It uses the same request lock and immutable observation tuple as preparation. If preparation already committed, abandonment returns that actual record so staff can use the normal unfinished-discard workflow. Local request references are cleared only after durable abandonment; a delayed preparation cannot recreate discarded intent.

Capture status is `prepared`, `reserved`, `ready`, `blocked`, `discarding` or `abandoned`. An active lease indicates work in progress. Failures retain fixed error codes and bounded cooldowns; unsupported files, changed source metadata and byte discrepancies become explicit blocked outcomes. A metadata scan still reports `capture_available:false` and its observations keep `file_sha256:null`: independent original-capture receipts provide actual byte evidence.

## Source and private-byte verification

The official [Postman collection](https://developers.ezyvet.com/ezyvet-api.postman_collection.json) documents the attachment-ID download route `/v1/attachment/download/:id` with bearer authorization and exact-ID/Animal-parent list filters. The worker reads canonical metadata before and after downloading, requiring the frozen attachment ID, file ID, Animal parent and stable metadata digest to match. Temporary URL renewal can change raw-record digests without changing the stable fingerprint. Those before/after raw hashes are retained separately; no temporary download URL or arbitrary provider field is stored.

The application accepts PDF, JPEG and PNG originals up to 20 MiB. It requires exact 200 responses, consistent byte lengths, identity encoding and supported byte signatures, and rejects redirects and partial responses. Streaming limits bound both total bytes and allocation overhead. These are application limits and observed-byte checks, not a vendor guarantee of a consistent export or atomic metadata/file revision.

After source checks, the worker freezes one immutable object intent containing byte SHA256, size, MIME and before/after observation evidence. Uploads use the authenticated staff JWT, a server-generated path and `upsert:false`. The worker reads the actual private object back and verifies its checksum, size and MIME before committing an immutable capture receipt under current source locks and an unexpired lease.

When an upload or completion response is lost, recovery inspects the reserved private object before another provider read. Existing matching bytes can be finalized without re-downloading. If no object exists, a retry must still match the original immutable byte intent. Different bytes are never overwritten under that intent. Retrieval uses the owned ready receipt, rehashes stored bytes server-side, and returns a noncacheable download with `nosniff`; the browser independently rehashes the returned bytes before creating a download. No provider access is needed to recover a ready receipt or retrieve its bytes.

## Database, Storage and cleanup

Additive migration 7000 creates the private request, attempt/failure, object-intent and immutable capture ledgers plus the `ezyvet-attachment-originals` bucket. It preserves canonical 6300/6500/6900 and extends the verified migration inventory from 86 to 87. Requests freeze actor, mapping, patient/client, `(run_id,page,ordinal)`, snapshot/head and raw/stable observation identity. Browser RPCs are active-administrator and owner-scoped; direct ledger reads, object reads, object overwrite and object deletion are not granted to browsers.

Storage INSERT policy checks the authenticated owner, reserved intent, live lease and current source while locking the request. Capture and metadata claims honor the same source gate and each other's leases/cooldowns. Database operations preserve the established lock order and check wall-clock lease expiry after waits, including source and Storage-object locks.

Discard first fences an unfinished request, invalidating its lease. The worker rechecks that owned, immutable discarding intent and performs privileged deletion only for its path, then confirms absence before recording `abandoned`. Staff uploads cannot create an accessible object after the fence. Lost deletion or finalization acknowledgements recover the same operation. Ready captures cannot enter discard, and cleanup does not delete request or observation history.

API originals remain separate from `patient_documents` and manual-export receipts. Capture does not promote the clinical chart, approve source claims, enable a release, create billing/inventory effects or send messages. The separate [API-original chart review workflow](reviewed-api-originals.md) preserves this receipt for explicit admission and DVM acknowledgment. Client release integration remains separate; neither workflow relabels the original as a manual export.

## Configuration and remaining work

`capture-ezyvet-attachment` requires a staff JWT and repeats active-owner authorization inside the handler. Fresh source traffic uses the existing staging-only import configuration, explicit `read-attachment` scope and production-source opt-in when appropriate. Source origin/site must match the frozen request. Default contact/animal read resources and hosted settings remain unchanged.

Issued-practice acceptance still needs bounded samples for exact-ID response shape, supported file types, download/redirect/header behavior and source entitlement. Consult/Contact attachments, bulk reconciliation, clinical approval, native chart promotion, release integration and hosted commissioning remain separate work. No new private API registration is assumed merely because the integration is read-only.

## Validation

Local validation completed:

- `npm run check`: 516 unit tests, lint, TypeScript and production build passed. Frozen Deno checks passed for all 31 Edge entrypoints and the attachment parser.
- All 269 browser cases passed across the full run and focused reruns: the full run passed 263; six initially failing cases passed after adding discovery RPC fixtures, scoping one ordering assertion to its workflow, and serially rerunning timing-sensitive cases. This was not a single clean full-suite run. The new capture workflow includes 24 focused browser cases.
- 73 SQL files passed 2,704 assertions. Original-capture harness: 136 checks including SQL-file success, setup, observed lock races and cleanup; canonical contention: 162 checks. See the [SQL and contention receipt](../evidence/attachment-originals-sql-contention-local-20260913.json).
- Real local Auth, PostgREST and Storage roundtrips passed 102 checks (50 metadata, 52 originals), including lost responses, denied direct reads/overwrite, tamper rejection, historical recovery and fenced discard. The handler ran in a local harness, not a deployed Edge gateway. Provider HTTP responses were synthetic. See the [HTTP receipt](../evidence/attachment-originals-http-local-20260913.json).
- A fresh populated 51→87 upgrade/restore preserved two requests, two immutable intents and one ready capture. Both ready and reserved physical originals were reverified, permissions matched, and private reads remained denied. See the [restore receipt](../evidence/attachment-originals-restore-local-20260913.json).

Owned disposable resources were cleaned up. The historical-household test uses an owner-only fixture transaction to simulate a future transfer; it does not establish a household-transfer product feature. No hosted deployment, live provider acceptance, clinical approval or release integration is implied. See the [implementation contract](../plans/attachment-original-capture-contract.md) for exact RPC/worker shapes and recovery invariants.
