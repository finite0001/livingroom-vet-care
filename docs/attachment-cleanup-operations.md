# Abandoned conversation upload cleanup

Candidate implementation; not deployed or enabled. Target backend remains `mgadheotkdnrsatfivjy`. This is temporary-upload cleanup, not medical-record retention. Verified uploads, pending uploads, incoming originals and prepared-message evidence are excluded.

## Preconditions

Require migration20260916130000, successful SQL/concurrency/actual Storage acceptance, the reviewed read-only inventory, an explicit grace setting and deployed worker endpoint verification. The current cleanup SQL suite passed in CI35097849305 at9b46cc6; the rest of that run is still active. Later discovery/concurrency changes are not covered by that result. Do not infer hosted readiness from local tests.

## Server settings

- `ATTACHMENT_CLEANUP_ENABLED`: absent or any value except `true` disables operations.
- `ATTACHMENT_CLEANUP_GRACE_HOURS`: required integer24–720; no implicit default. Disposable tests use168; this does not choose the hosted retention setting.
- Existing configured server credentials are checked by `authenticateWorker`. Ordinary staff tokens are rejected. Never put worker credentials in the browser.
- No automatic schedule is installed. Each request attempts one upload ID.

## Bounded operation

1. Run `scripts/attachment-retention/inventory.sql` read-only and inspect aggregate categories. Unknown objects and superseded incoming paths are review categories, not covered by this worker.
2. Through the server role, call `list_abandoned_attachment_cleanup_candidates` with the chosen `p_grace_hours` and `p_limit` from1 to100. It returns only upload IDs and reasons. It excludes active leases and changed object identities. Discovery is a snapshot, not authorization to bypass the claim.
3. POST `{"upload_id":"<candidate UUID>"}` to `cleanup-abandoned-attachment` using configured server-worker authentication. Do not send a Storage path or caller grace override. Process a bounded batch; do not loop indefinitely.
4. `complete` identifies a durable cleanup receipt. `empty` means no eligible stored object was claimed; it is not a newly completed deletion receipt. A503 is unconfirmed, not success. Inspect the saved receipt and recover the same upload after a live lease has expired; never invent a new path to force progress.
5. Compare the read-only inventory after the batch and inspect remaining claimed receipts through the server database. Retain audit rows. A complete receipt with a reappearing object requires investigation; it is not silently recycled.

## Recovery and stopping

Set `ATTACHMENT_CLEANUP_ENABLED` to a value other than `true` to stop new endpoint requests; already-running requests may finish. No bulk restore/deletion operation is part of this worker. Exact-token completion replay returns the existing receipt only while the object remains absent. Object identity conflicts, prepared-message references and permission/service errors remain failures for investigation.

Hosted configuration, deployment, worker acceptance, operational monitoring and superseded-incoming cleanup remain outstanding.
