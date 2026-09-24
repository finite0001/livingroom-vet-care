# Current-stack synthetic restore rehearsal — 2026-09-24

## Result

PASS: an isolated synthetic source database and private Storage inventory were backed up, restored into a separate isolated destination, verified, and cleaned up.

The protected artifact directory, database archive, Storage bytes, local status files, command log, and disposable credentials remain outside Git. This file records only the sanitized review facts.

## Scope

- Migration inventory: 148 local migrations, including the Sep 19–22 hosted-readiness scheduler, appointment, outbound-delivery, inbound-SMS, staff-queue, and contact-abuse-control migrations.
- Source project: `lrv-restore-98f23ccc88-source`.
- Destination project: `lrv-restore-98f23ccc88-destination`.
- Result `git_commit`: `d70cd67b63512b1eb122687b59e8290dceb67b8e` (pre-evidence HEAD; runner and fixture hashes below bind the tested worktree files).
- Cleanup: verified; no generated `lrv-restore-98f23ccc88` containers remained after PASS.

## Timings and hashes

- Backup: 12.71 seconds.
- Restore and verification after destination startup: 9.78 seconds.
- Total including stack starts and checked cleanup: 129.74 seconds.
- Result JSON SHA-256: `d4d79695b21bf194ac5f9a55c1abb48b71bb1c50fd585aef0d83135be109163c`.
- Runner SHA-256: `9937d6b9d0f73f863b653d0a7eba0f9cbd42c34ee012fae056b80e3054d0f1f4`.
- Fixture SHA-256: `b8ab378c7d2b82d86b8ed176e5a2e9ca34d6b6d77810864fc6b742185f17a66f`.
- Database archive SHA-256: `0459afb56d678394810c0c992926d173a19e7e11cbaf0c9763bd482c5efeb485`.
- Physical Storage files: 10 restored files; inventory and metadata matched.

## Verified acceptance

- Fresh local Auth login succeeded after restore.
- Captured rows and IDs matched for clinical, billing, inventory, Auth, Storage metadata, migration ledger, reviewed ezyVet receipts, release artifacts, communications, and attachment lifecycle fixtures.
- Signed SOAP/addendum history, invoice total `9000` cents, accounting credit `500` cents, and stock balance `8` units survived restoration.
- Private original document checksum matched SHA-256 `1fc62aca512802276c79f6f3fc12c6dc743239fde62ad71938e6b698dc1d9c5e`; anonymous/public reads stayed denied.
- Reviewed API originals, approval/correction/cancellation decisions, release email/link artifacts, mixed prescription/API release packages, and exact link read-counter increments were restored and verified.
- Conversation attachment lifecycle restored four outgoing states, two incoming states, five physical originals, cleanup replay, and staff/anonymous access boundaries.
- Communications fixture restored provider-request-free email/inbound attachment evidence, reviewed payload hash, cleanup recovery, and original bytes.
- Routine and access inventories matched reviewed expectations after restore; public security comparison was equal.

## Scheduler containment

The current stack intentionally installs the scheduler timetable. The restored verification proved it is still contained without commissioning secrets:

- `pg_cron` installed: `true`.
- `pg_net` installed: `true`.
- Expected cron jobs only:
  - `cleanup-abandoned-attachment`
  - `dispatch-outbox`
  - `process-inbound`
  - `process-stripe-events`
  - `queue-reminders`
  - `scheduler-reconcile`
- Unexpected cron jobs: none.
- Scheduler Vault secret count for `project_url` / `scheduler_worker_key`: `0`.
- Dispatch probe: `scheduler_dispatch('dispatch-outbox')` returned `configuration_missing` with missing `project_url, scheduler_worker_key` before any worker call.

## Limits

This is local synthetic restore evidence, not hosted PITR acceptance, a production RTO/RPO, provider delivery acceptance, clinical approval, or incident cutover rehearsal. Edge runtime, provider credentials, scheduler Vault secrets, and SMTP delivery were not commissioned; local Auth used the mail catcher only.
