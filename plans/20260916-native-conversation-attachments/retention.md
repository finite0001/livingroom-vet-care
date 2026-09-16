# Conversation attachment retention and cleanup implementation plan

This plan preserves message evidence and addresses temporary object accumulation. No automated cleanup is implemented or enabled. The read-only inventory at `scripts/attachment-retention/inventory.sql` reports counts and sizes, without patient names, file names or object paths. It does not classify any object as immediately safe to delete.

## Evidence derived from current schema

- Migration115 permits uploading → ready or uploading → abandoned only. Abandoned reservations cannot verify or accept an authenticated upload. Reservation rows cannot be deleted; their identity remains evidence.
- Ready uploads may be referenced by migration116 manifests and immutable captured payloads. Even apparently unreferenced ready uploads may be needed by an unresolved browser review. Retain them; do not infer abandonment from age or absence of an outbox row.
- Incoming migration117 gives each capture attempt a fresh token/path. Only the current exact attempt may finalize; a ready capture is immutable. Retain every current path, including an expired but unreplaced attempt.
- An older path under the same incoming/attachment identity can be superseded by a different saved attempt path. Late uploads from the old worker may still finish, but cannot finalize under the replaced token. Cleanup must be repeatable and account for late-arriving orphan objects.
- Storage metadata is not proof of byte deletion. Production cleanup must use the Storage API, never SQL DELETE on storage.objects. Synthetic database tests are the only existing direct metadata-delete use.

## Implementation sequence

1. Run the read-only inventory in disposable acceptance and then on the selected backend. Keep unknown objects separate; unknown identity is not permission to delete.
2. Implement durable cleanup receipts for exact bucket/path/object identities, with reviewed reason and attempt state. Limit scope to explicitly abandoned uploads and provably superseded incoming paths. Retain database reservations, message rows, captured payloads, ready originals and audit evidence.
3. Recheck eligibility immediately before Storage deletion; bind the receipt to the observed object identity and creation time so a replaced object cannot be silently included. Use a bounded worker with a default-off gate and explicit minimum object age. The age is operational grace, not a clinical-record retention rule; record the selected setting before enabling the worker.
4. Remove through Storage API, confirm absence, then finalize the receipt. A lost response must recover the same cleanup intent. Failed/uncertain deletion remains retryable and cannot be reported complete. Do not run cleanup for unknown objects or current capture paths.
5. Cover ready/upload-finalization exclusion, active/replaced capture paths, late old-worker upload, API deletion failure, lost deletion response and cleanup-worker contention with actual local Storage and database tests.
6. Add staff recovery for unfinished upload reservations separately. Expiring a draft or discarding verified content changes staff behavior and requires an explicit visible workflow, not a background age-only deletion.

## Acceptance still required

Actual cleanup implementation, runtime tests, chosen grace setting, hosted inventory review, monitoring and a bounded enabled-worker acceptance run remain open. This plan and inventory do not satisfy those gates. Broader medical-record retention remains outside temporary attachment cleanup and must not be inferred from it.

## Shared cleanup routine candidate

`supabase/functions/_shared/cleanup-abandoned-attachment.ts` now implements one bounded abandoned-upload cleanup attempt through injected adapters. It validates the exact lease/path/object identity, revalidates eligibility before removal, distinguishes inspection errors from confirmed absence, recovers uncertain deletion responses only through absence, and requires a matching durable completion receipt. Seven unit cases and targeted lint pass. This module has no deployed entry point and no connected database/Storage adapters; it cannot currently delete hosted files. The database receipt/lease implementation, configured grace interval, real Storage acceptance and superseded-incoming cleanup remain open.

## Database receipt draft

`abandoned_cleanup.sql.draft` defines service-only claim/revalidate/finalize and immutable cleanup evidence. New claims require an explicit24–720 hour object/reservation grace, a terminal abandoned upload, no prepared-message reference, and the exact Storage object identity/time; a live token cannot be stolen. Reclaim retains the original receipt's identity and grace. Finalization requires object absence and the current token. `abandoned_cleanup.test.sql.draft` adds12 SQL cases for privileges, retained ready/pending files, grace, competing claims, token checks, absence and preserved evidence. These drafts are not canonical migrations/tests and have not been executed. Adapter integration and actual Storage acceptance are prerequisites to promotion.

## Storage adapter candidate

Added `attachment-cleanup-storage.ts`: inspect via a bounded successful list of the exact UUID folder/name, return null only for confirmed absence, reject incomplete/truncated/ambiguous object identities, and remove only the validated exact path through the Storage API. Listing errors—including404/403-shaped errors—propagate rather than pretending absence. This follows the distinction in https://supabase.com/docs/guides/storage/debugging/error-codes and avoids the installed SDK's exists() ambiguity across400/404 cases. Object creation timestamps compare parsed instants rather than textual formatting. The five adapter tests plus seven cleanup-core tests all pass; targeted lint/diff pass. Database adapter/endpoint and actual Storage runtime acceptance remain pending, so no cleanup has been enabled.

## Canonical runtime candidate

Promoted the receipt draft and12 SQL cases to migration20260916130000 and `supabase/tests/abandoned_attachment_cleanup.test.sql`; canonical inventory118. The earlier draft-path references are historical. `abandoned-cleanup-adapter.ts` binds service RPCs and exact Storage adapters, checks matching upload/lease fields on every revalidation, and runs the bounded core. Deno frozen checking, targeted lint, syntax and12 shared-unit cases pass.

The pending actual localhost integration now creates an authenticated temporary upload, abandons it with the real staff RPC, ages only its synthetic fixture timestamps, invokes cleanup with an explicit168-hour grace, simulates a lost successful Storage-delete reply, and checks durable completion plus retained reservation and actual object absence. Runtime SQL and Storage acceptance are still pending. There is no deployed cleanup endpoint/scheduler; no hosted deletion has occurred. Superseded incoming-path cleanup remains separate open work.

## Completion-reply recovery follow-up

Finalization now locks upload then receipt and permits exact-token completed-receipt replay only while the Storage path remains absent. Different tokens and unexpected reappearing objects are rejected; no second deletion is performed. Added two SQL cases (14 total) and an actual service-RPC replay assertion to the pending local harness. Targeted lint, Node syntax and diff checks pass; these runtime additions are not yet executed. CI35096847299 remains active at3280907 and excludes this follow-up, so it must finish before the next push.

## First cleanup runtime failure and fixture correction

CI35096847299 applied migration118 successfully, then its SQL job failed at the synthetic Storage-metadata deletion in `abandoned_attachment_cleanup.test.sql`. The first9 cleanup assertions passed. Supabase's storage.protect_delete rejected direct metadata deletion; this was a fixture setup failure, not a successful complete suite or actual Storage cleanup result. The fixture now uses the repository's existing transaction-local `storage.allow_delete_query` override around only its exact synthetic metadata row deletion and restores false immediately. The production adapter still removes through Storage API. Diff checks pass; corrected SQL and the local completion-replay changes await rerun. The frontend job remains active, so do not cancel it with a new push.

## Default-off server endpoint

Added `cleanup-abandoned-attachment` Edge entry with the repository's authenticateWorker boundary. It accepts only POST with one upload_id, configured server-worker credentials, ATTACHMENT_CLEANUP_ENABLED=true and an explicit24–720 ATTACHMENT_CLEANUP_GRACE_HOURS. Callers cannot pass object paths or override grace. Gateway JWT checking is disabled for this server-only route because secret API keys are not JWTs; the handler explicitly verifies configured server credentials before its gate or operations. Errors omit private details. No schedule, deployment or enabled flag exists.

Five handler tests, frozen Deno entry-point checking, targeted lint and diff checks pass. Actual endpoint HTTP/auth acceptance remains pending. CI35096847299 still has its frontend job running after the documented SQL-fixture failure, so corrected tests, completion replay and this endpoint remain local until terminal evidence permits the next push.
