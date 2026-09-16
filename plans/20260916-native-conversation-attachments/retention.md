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
