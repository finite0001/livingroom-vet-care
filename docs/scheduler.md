# Scheduler commissioning and verification

The database scheduler (migration `20260922120000_b1_scheduler.sql`, design in `plans/2026-09-21-scheduler/B1-contract.md`) is installed on every database the migrations reach. `pg_cron` calls `public.scheduler_dispatch(job)`, which reads two **Vault** secrets and posts to the Edge worker with `pg_net`:

| Cron job | Cadence | Edge worker |
| --- | --- | --- |
| `dispatch-outbox` | every minute | sends queued `communication_outbox` messages (reminders included) |
| `process-inbound` | every minute | processes received replies |
| `process-stripe-events` | every minute | applies Stripe events |
| `queue-reminders` | every 15 minutes | `queue_due_reminders()`: appointment, vaccine and lab reminders into `communication_outbox` |
| `cleanup-abandoned-attachment` | every 30 minutes | attachment housekeeping |
| `reconcile-operational-tasks` | every 5 minutes, activated separately | bounded task reconciliation under the reviewed database policy/window and `OPERATIONAL_RECONCILIATION_ENABLED` |
| `queue-invoice-reminders` | hourly, 09:00–16:59 America/Denver | eligible enrolled unpaid invoices under the practice policy and `INVOICE_REMINDERS_ENABLED`; queues only |
| `scheduler-reconcile` | every minute | database only; records the HTTP outcome of each request |
| `purge-expired-email-payloads` | daily, 09:17 UTC | database only (migration `20260930130000`); `scheduler_purge_expired_email_payloads()` clears frozen release/invoice email bytes 90 days after an abandoned request or a provider-accepted send. Never pending, failed or uncertain sends; hashes, manifests and audit rows are kept. Its outcome is in `cron.job_run_details`, not on the ops card. |

Each call posts `{}` with a 30 s `pg_net` timeout (`20260930130000`; it was 5 s). The queue workers (`dispatch-outbox`, `process-inbound`, `process-stripe-events`, `cleanup-abandoned-attachment`) each process a bounded batch per call: they claim until the queue is empty, 25 items, or a 20 s budget, and stop early at the first failed or uncertain item, so a provider or configuration fault still fails at most one item per call. Their response body is a count summary (`items`, per-state counts, `stopped`, `elapsed_ms`); reconcile records only the HTTP status.

Until both Vault secrets exist, every HTTP job records `configuration_missing` (at most once an hour per job) and calls nothing. This describes the missing-configuration behavior, not a current hosted observation. Use the read-only verification below to inspect the selected project before creating or rotating any secret. The table documents the original scheduler jobs; later feature migrations add diagnostic PDF, operational-task and invoice-reminder work. Check the live job inventory against the exact candidate migrations.

## What the two secrets are

| Vault name | Value | Notes |
| --- | --- | --- |
| `project_url` | `https://<project-ref>.supabase.co` | The application backend is `mgadheotkdnrsatfivjy`. Check the ref before every step; `ugpyjacqganaqtsiekay` is retained legacy Lovable Cloud and must not be used. No trailing slash. |
| `scheduler_worker_key` | one of the project's `sb_secret_…` keys | Must be a key listed in the functions' `SUPABASE_SECRET_KEYS`. Publishable, anon and legacy JWT keys are rejected by `_shared/worker-auth.ts`. |

No value belongs in the repository, a migration, a workflow, chat, or shell history.

## Before you set them

Setting the secrets starts roughly 134,000 Edge invocations a month (B1 contract §3). It does not send messages by itself: `queue-reminders` stays disabled unless `REMINDER_SCHEDULER_ENABLED=true` and `APP_ENV` is `staging` or `production`, reminder policies default disabled, and provider delivery keeps its own gates. Confirm first:

1. The Edge functions listed above are deployed from the reviewed commit (`docs/hosted-edge-commissioning.md`). **`process-stripe-events` in particular must be deployed before the secrets exist**, or its job records a 404 every minute; it is safe to deploy while Stripe is off (it answers `{"state":"disabled"}`).
2. Provider gates are where you intend them. Texts go through CloudTalk (`+1 720-764-6677`); Twilio remains in code but is not used.
3. Dr. Edler has reviewed reminder wording (`docs/clinical-staff-acceptance-register.json`, `C-PILOT-08`) before any reminder policy is enabled.

## Set the secrets (owner)

**Option A — Supabase dashboard.** Project `mgadheotkdnrsatfivjy` → Integrations → Vault → *Add new secret*. Create `project_url` and `scheduler_worker_key` with the values above. To rotate, edit the existing secret; do not create a second one with the same name.

**Option B — psql (idempotent; also the rotation procedure).** Uses `scripts/scheduler/commission-vault-secrets.sql`. psql 15 or newer reads the values from environment variables, so nothing appears in argv or history. The script validates the shapes, creates or updates each secret, and prints only names, timestamps and the project URL.

```sh
# Connection string for mgadheotkdnrsatfivjy (dashboard → Connect → session pooler). Input hidden.
read -rs LRV_DB_URL
read -r  LRV_PROJECT_URL             # https://mgadheotkdnrsatfivjy.supabase.co
read -rs LRV_SCHEDULER_WORKER_KEY    # sb_secret_...
export LRV_DB_URL LRV_PROJECT_URL LRV_SCHEDULER_WORKER_KEY

# 1. Dry run: validates and rolls back.
LRV_DRY_RUN=1 psql "$LRV_DB_URL" -X -f scripts/scheduler/commission-vault-secrets.sql
# 2. Commit.
psql "$LRV_DB_URL" -X -f scripts/scheduler/commission-vault-secrets.sql
unset LRV_SCHEDULER_WORKER_KEY LRV_DB_URL
```

Running it again with new values rotates the secrets in place. The Edge functions pick up their own copy of the key from `SUPABASE_SECRET_KEYS`; a rotated database key must still be listed there.

## Verify (read-only)

```sh
psql "$LRV_DB_URL" -X -f scripts/scheduler/verify-scheduler.sql
```

The script opens a `READ ONLY` transaction and prints:

1. whether each Vault secret is present (never its value);
2. every cron job with its last `pg_cron` execution and the last application receipt (`scheduler_job_runs` + `scheduler_job_results`);
3. the latest five `queue-reminders` runs with queued/blocked/skipped counts.

The same data appears on the **Scheduled jobs** card in `/hub/admin/operations`.

| What you see | Meaning | Action |
| --- | --- | --- |
| `receipt_outcome = configuration_missing` | a secret is absent | expected before commissioning; after it, recheck the names |
| `dispatched (awaiting reconcile)` | request sent, response not yet recorded | wait one minute |
| `ok`, HTTP 2xx | worker accepted the call; a disabled worker also returns 200 | inspect the worker receipt and feature policy to establish actual execution |
| `failed`, HTTP 401 | the key is not in `SUPABASE_SECRET_KEYS` | rotate the Vault key or the function secret |
| `failed`, HTTP 404 | function not deployed at that slug, or wrong `project_url` | check the ref and deployment |
| `cron_status` not `succeeded` | `pg_cron` could not run the SQL | read `cron_message` |

After commissioning, allow two minutes for the one-minute jobs to show `ok`. `configuration_missing` receipts are written at most once an hour, so an old receipt time before commissioning is normal.

## Stop the scheduler (kill switch)

Deleting either secret stops every outbound call on the next tick. The jobs keep running and record `configuration_missing`, which is the safe, visible state:

```sql
delete from vault.secrets where name in ('project_url', 'scheduler_worker_key');
```

Do not unschedule the cron jobs to stop traffic: replaying migrations would reinstall them, and removing them hides the state from the operations card.

`public.apply_retention_policies()` must never be scheduled (B1 contract §7).

## Attachment cleanup preview

The cleanup worker accepts authenticated `{"dry_run":true}` requests while
`ATTACHMENT_CLEANUP_ENABLED=false`. Configure `ATTACHMENT_CLEANUP_GRACE_HOURS`
explicitly (24–720 hours; staging beta uses 168). Preview calls only the candidate
discovery RPC: it never claims uploads, reads Storage objects, or deletes files.
The response reports `mode:"preview"`, the server grace, and a candidate count
capped at 25; a count of 25 is not an exhaustive total. Invalid worker credentials
still return 401. Ordinary `{}` calls remain disabled until the destructive gate
is explicitly enabled.

Eligibility is limited to abandoned uploads in `conversation-attachment-uploads`,
excludes uploads referenced by frozen email manifests, and requires both upload
and object to exceed the configured grace. Expired cleanup claims can be recovered
only for the same recorded path/object identity. Every actual cleanup must still
claim, revalidate, remove, and confirm absence before recording completion.

November 6 staging commissioning and synthetic acceptance are recorded in
[the backend remediation report](beta-backend-remediation-2026-11-06.md).
Invoice reminders use their own immutable `invoice_reminder_runs` receipts and
are not listed in `scheduler_job_results`; inspect both the cron execution and
that feature's receipt when checking the complete schedule path.
