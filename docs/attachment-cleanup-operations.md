# Abandoned conversation upload cleanup

Candidate implementation; not deployed or enabled. Target backend remains `mgadheotkdnrsatfivjy`. This is temporary-upload cleanup, not medical-record retention. Verified uploads, pending uploads, incoming originals and prepared-message evidence are excluded.

## Preconditions

Require migration20260916130000, successful SQL/concurrency/actual Storage acceptance, the reviewed read-only inventory, an explicit grace setting and deployed worker endpoint verification. CI35107565034 passed all jobs at843ca92, including bounded discovery, 19 cleanup SQL assertions, observed cleanup races and the 33-check incoming HTTP/Auth/RPC/Storage sequence. Later release-harness commits require their own verification. Do not infer hosted readiness from local tests.

## Server settings

- `ATTACHMENT_CLEANUP_ENABLED`: absent or any value except `true` disables operations.
- `ATTACHMENT_CLEANUP_GRACE_HOURS`: required integer24–720; no implicit default. Disposable tests use168; this does not choose the hosted retention setting.
- Existing configured server credentials are checked by `authenticateWorker`. Ordinary staff tokens are rejected. Never put worker credentials in the browser.
- The scheduler (`20260922120000_b1_scheduler.sql`) posts `{}` to this worker every 30 minutes. It does nothing until the two settings above are valid: a disabled or unconfigured worker answers 503, which the ops card shows as failed.

## Request shapes

- **Batch (scheduled):** POST `{}`. The worker calls `list_abandoned_attachment_cleanup_candidates` with the server-configured grace and `p_limit` 25, then attempts each returned upload in order through the same claim, revalidate, remove and finalize path as an explicit request, within a 20 s budget (below the scheduler's 30 s request timeout). The response is a count summary: `{"mode":"batch","candidates":n,"complete":n,"empty":n,"stopped":"empty"|"item_cap"|"time_budget"|"halted","elapsed_ms":n}`. Discovery is a snapshot, never authorization: each upload must still win its own claim, and `empty` means a candidate was no longer eligible when claimed. The first unconfirmed cleanup stops the batch and answers 503 with that `upload_id`; recover that same upload (below). Uploads not reached are picked up by the next run.
- **Explicit (operator recovery):** POST `{"upload_id":"<candidate UUID>"}` attempts exactly that upload. Any other key, a Storage path or a caller grace override is refused with 400.

## Bounded operation

1. Run `scripts/attachment-retention/inventory.sql` read-only and inspect aggregate categories. Unknown objects and superseded incoming paths are review categories, not covered by this worker.
2. Through the server role, call `list_abandoned_attachment_cleanup_candidates` with the chosen `p_grace_hours` and `p_limit` from1 to100 to preview what a batch would attempt. It returns only upload IDs and reasons. It excludes active leases and changed object identities. Discovery is a snapshot, not authorization to bypass the claim.
3. Either let the scheduler post `{}`, or POST `{}` or `{"upload_id":"<candidate UUID>"}` to `cleanup-abandoned-attachment` yourself using configured server-worker authentication. Do not send a Storage path or caller grace override.
4. `complete` identifies a durable cleanup receipt. `empty` means no eligible stored object was claimed; it is not a newly completed deletion receipt. A503 is unconfirmed, not success. Inspect the saved receipt and recover the same upload after a live lease has expired (it reappears in discovery as `recover_cleanup`); never invent a new path to force progress.
5. Compare the read-only inventory after the batch and inspect remaining claimed receipts through the server database. Retain audit rows. A complete receipt with a reappearing object requires investigation; it is not silently recycled.

## Recovery and stopping

Set `ATTACHMENT_CLEANUP_ENABLED` to a value other than `true` to stop new endpoint requests; already-running requests may finish. No bulk restore/deletion operation is part of this worker. Exact-token completion replay returns the existing receipt only while the object remains absent. Object identity conflicts, prepared-message references and permission/service errors remain failures for investigation.

Hosted configuration, deployment, worker acceptance, operational monitoring and superseded-incoming cleanup remain outstanding.
