# B1 contract — the scheduler

Status: **for implementation.** Date: 2026-09-21. Author: the stronger-model seat, per `plans/2026-09-19-commercial-readiness-map/MAP.md` §5, which marks B1 as `S→K`: *"a stronger model writes a short design contract first… Do not start without the contract."*

**Precondition, run before starting:**

```
git fetch origin && git merge-base --is-ancestor 024fd13 origin/main \
  && echo "OK: main is the product" || echo "STOP: main is not the product"
```

**Tier:** the migration, the SQL functions and the credential path are **K+R** — they touch privileges and a key. Installing the jobs on a hosted project is **owner + stronger model**, never the executor alone.

---

## 1. What is missing, measured

Every fact below was checked on 2026-09-21; the command is named beside it.

| Check | Result |
|---|---|
| `git grep -l "cron.schedule" -- supabase/migrations/` | **0 files.** Nothing schedules anything. |
| `git grep -ln "net.http_post\|pg_net" -- supabase/migrations/` | **no match.** The database never calls out. |
| `vercel.json` | no `crons` key. |
| `.github/workflows/` | no `schedule:` trigger on any workflow. |
| `supabase/functions/` | `dispatch-outbox`, `queue-reminders`, `process-inbound`, `process-stripe-events`, `cleanup-abandoned-attachment` **all exist** — with nothing to invoke them. |

So on a real deployment today: queued email and SMS are never sent, reminders never fire, inbound replies and attachments are never processed, Stripe events are never applied, and abandoned uploads are never cleaned. The map's own acceptance flow (household → booking → reminder → SOAP → charge → send → client reply → reconcile) cannot complete, because the timer that drives it does not exist.

**What already exists and must be reused, not rebuilt:**

- `queue-reminders` is already a scheduler-shaped worker: `supabase/functions/_shared/reminder-scheduler.ts` gives it a handler that refuses non-POST, refuses an unauthenticated caller, returns `disabled` unless `REMINDER_SCHEDULER_ENABLED === "true"`, and refuses with 503 unless `APP_ENV` is `staging` or `production`. It fails closed already.
- The operations page **already renders a "Scheduler runs" card** — `src/hub/features/operations/OperationsPage.tsx:408`, asserted by `e2e/operations.spec.ts:259` — fed by `public.reminder_scheduler_runs` / `reminder_scheduler_results` (`supabase/migrations/20260913440000_operations_visibility.sql:52`). Rows carry `run_id`, `outcome` (`started` / `failed` / `completed`), `requested_limit`, `started_at`, `finished_at`.

## 2. The decision

**`pg_cron` + `pg_net` inside the database, with the caller credential held in Supabase Vault.**

- `pg_cron` runs the timetable; `pg_net` makes the HTTP call to the edge function.
- The project URL and the caller key live in **Vault**, created at commissioning by the owner. **They never appear in a migration, a workflow, or the repository** — which is exactly what the map requires.
- This is Supabase's own documented pattern for invoking Edge Functions on a schedule ([Scheduling Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions)).

**Availability, measured on 2026-09-21** against a local stack of this project's image (`docker exec supabase_db_<ref> psql -c "select name, default_version, installed_version from pg_available_extensions where name in ('pg_cron','pg_net')"`):

```
pg_cron|1.6.4|        ← available, not yet installed
pg_net |0.20.4|       ← available, not yet installed
```

So the migration can install them. **Hosted availability is a commissioning check, not an assumption** — see §9.

**The alternative considered, and rejected:** an external scheduler (GitHub Actions `schedule:`, or a hosted cron service) holding the key in its own secret store.

- It avoids touching the database, but it puts a high-privilege `sb_secret_…` key — one that can read and write every table — into a third party, for a task the database can do itself.
- GitHub scheduled workflows are disabled on repositories with no activity for 60 days, and GitHub makes no timing guarantee. A clinic's reminders must not stop because the repository went quiet.
- It still leaves the jobs invisible to `/hub/admin/operations`.

Revisit this only if the hosted project turns out not to offer `pg_cron` (§9, step 1).

## 3. The jobs

Six jobs. Five dispatch a worker; the sixth reconciles outcomes.

| Job name | Calls | Cadence | Why this cadence |
|---|---|---|---|
| `dispatch-outbox` | `dispatch-outbox` | `* * * * *` (every minute) | Client-visible latency: queued estimates, invoices and replies leaving the building. |
| `process-inbound` | `process-inbound` | `* * * * *` | A client reply should appear in the inbox within a minute. |
| `process-stripe-events` | `process-stripe-events` | `* * * * *` | `_shared/stripe-event-worker.ts` processes **one leased event per call** ("A missed acknowledgement is recovered by lease expiry"), so cadence is throughput. |
| `queue-reminders` | `queue-reminders` | `*/15 * * * *` | Reminders are date-driven, not minute-driven; 15 minutes is invisible to the user and costs a quarter of the invocations. |
| `cleanup-abandoned-attachment` | `cleanup-abandoned-attachment` | `*/30 * * * *` | Housekeeping. Nobody waits for it. |
| `scheduler-reconcile` | — (database only) | `* * * * *` | Records what happened to the requests the five jobs fired. See §6. |

**Cost, stated plainly for the owner:** the five HTTP jobs run 4,464 times a day (three at every minute = 4,320, reminders 96, cleanup 48) — about **134,000 invocations a month**. `scheduler-reconcile` is database-only and costs none. That is inside Supabase's included allowance, but it is not zero, and the owner should see the number before it runs.

## 4. The credential path

The workers authenticate with `_shared/worker-auth.ts`, which accepts exactly two things:

1. an `apikey` header whose value is `sb_secret_…` **and** matches one of the keys in the function's own `SUPABASE_SECRET_KEYS`; or
2. `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>` (legacy).

All five workers are already deployed with `verify_jwt = false` in `supabase/config.toml` (lines 13–95), so the platform will not demand a user JWT before the handler's own check runs.

**Therefore the Vault value must be one of the project's `sb_secret_…` keys** — the same value the functions receive in `SUPABASE_SECRET_KEYS`. Not the publishable key, not the anon key: those are rejected by design.

Two Vault secrets, created by the owner at commissioning (§9):

```sql
select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
select vault.create_secret('<the sb_secret_… key>', 'scheduler_worker_key');
```

The dispatch function reads them at run time:

```sql
select net.http_post(
  url     := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
             || '/functions/v1/' || p_job,
  headers := jsonb_build_object(
               'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'scheduler_worker_key'),
               'Content-Type', 'application/json'),
  body    := '{}'::jsonb,
  timeout_milliseconds := 5000
);
```

**When a secret is missing the job must fail loudly and visibly, never silently.** `scheduler_dispatch()` records a receipt row with outcome `configuration_missing` and a message naming the absent secret, and raises. The ops card then shows a red row — an operator sees that the scheduler is installed but unconfigured, instead of seeing nothing happening and assuming calm.

**Rotating the key is one place:** update the Vault secret. The functions pick up their own copy from their environment; nothing in the repository changes.

## 5. The migration

One new migration, timestamped after the newest existing file. It:

1. `create extension if not exists pg_cron;` and `create extension if not exists pg_net;` — both measured available (§2). **These statements must be guarded with `if not exists`** so a hosted project that already has them is untouched, and so a fresh database, `supabase db reset` and CI all stay green.
2. Creates `public.scheduler_job_runs` — the receipt table (§6) — with the same privileges discipline as `reminder_scheduler_runs`: RLS enabled, no anonymous access, service-role and admin read.
3. Creates `public.scheduler_dispatch(p_job text)` — `SECURITY DEFINER`, `search_path` pinned, granted to no client role; it reads Vault, posts, and inserts the receipt with the `net.http_post` request id.
4. Creates `public.scheduler_reconcile()` — same privileges; it fills in the outcome of requests that have a row in `net._http_response`.
5. Schedules the six jobs with `cron.schedule(<name>, <schedule>, $$select public.scheduler_dispatch('<job>')$$)`. `cron.schedule` with an existing name **updates** that job, so the migration is idempotent.

**Hard rule for the migration:** it must not fail when Vault is empty. A fresh local database and CI have no Vault secrets, and `supabase test db` must still pass. The `configuration_missing` path in §4 is what makes that true.

## 6. Visibility

The map requires *"scheduler runs visible in /hub/admin/operations"*. The page has a card for the reminder queue already; this adds a second card, **"Scheduled jobs"**, listing one row per job:

- job name, last requested time, last outcome, HTTP status, and the error text when there is one;
- red when the last outcome is `failed`, `configuration_missing`, or a non-2xx status;
- amber when the last run is older than three times its cadence — a job that silently stopped is worse than one that failed loudly.

`net.http_post` is **asynchronous**: it returns a request id and the response arrives later. That is why `scheduler_job_runs` stores the request id and why `scheduler-reconcile` exists — without it, "did the worker actually accept the call?" is unanswerable, and a 401 from a rotated key would look exactly like success.

## 7. What must never be scheduled

**`public.apply_retention_policies()` must not be given a cron entry.** Write that exclusion into the migration as a comment, so the next person reading it does not helpfully add it.

The reason, verified: the job is dormant and gated off (`app_settings.retention_enabled = 'false'`, `supabase/migrations/20260308184039_*.sql:346`), and it is revoked from `PUBLIC` and `anon` (`20260613225133_*.sql:2-4`). As configured it **archives conversations after 365 idle days and then hard-deletes them after 730** — a clock keyed to the **last message**, not the patient's **last exam**. Colorado requires records to be kept at least three years after the last exam (C.R.S. 12-315-119), so this job as written can destroy client communications belonging to a patient who is still being seen. It stays off until that clock is redesigned and approved. It is not this task's job to fix it — only to keep it unscheduled.

## 8. Nothing sends until the owner says so

Installing the timetable is not the same as turning the practice on. Every gate stays closed:

| Gate | Where | Off means |
|---|---|---|
| `REMINDER_SCHEDULER_ENABLED` | edge-function env | `queue-reminders` returns `disabled`, claims nothing, sends nothing |
| `OUTBOUND_DELIVERY_MODE` | `_shared/delivery-policy.ts` | `disabled` means the outbound path does not deliver to a real client |
| `APP_ENV` | edge-function env | anything other than `staging` / `production` makes `queue-reminders` return 503 |
| `EZYVET_*`, `STRIPE_*_ENABLED` | edge-function env | untouched by this task |

The cron jobs may be installed immediately and safely **because the workers already fail closed**. Enabling delivery is the owner's separate decision, with the provider secrets installed first.

## 9. Commissioning (owner + stronger model, never the executor)

1. **Confirm `pg_cron` and `pg_net` on the hosted project**, before relying on them:
   `select name, default_version, installed_version from pg_available_extensions where name in ('pg_cron','pg_net');`
   If either is missing, **stop** and return to §2's alternative rather than improvising.
2. Apply the migration. Confirm the six rows in `cron.job` are `active = true`.
3. Create the two Vault secrets (§4) on **staging first**. The value is one of the project's `sb_secret_…` keys; never paste it into this document, a commit, or a chat.
4. Watch the ops card: within three minutes every job should show a successful run, and `queue-reminders` should show its `disabled` answer rather than a failure.
5. Prove one real dispatch end to end with the gates still off, then with `OUTBOUND_DELIVERY_MODE=test` and a synthetic recipient.
6. Only then decide whether to enable delivery. That decision is the owner's, is separate, and is not implied by this contract.

## 10. Acceptance criteria

Every item must be checked and its real output recorded — in the pull request, not in a summary.

1. `supabase db reset` replays every migration from empty with no error, **including** the new one, and `supabase test db` passes.
2. A new pgTAP test proves the failure path with no Vault secrets present: `scheduler_dispatch('dispatch-outbox')` records a `configuration_missing` receipt and raises, and does not post anything.
3. A pgTAP test proves the receipt path with a stubbed request: a dispatch row is written with a request id, and `scheduler_reconcile()` fills in a status from a response row.
4. `select count(*) from cron.job` is six; the names are exactly the six in §3; `apply_retention_policies` appears in **no** cron job — assert that in the test, so a future edit cannot add it quietly.
5. The ops page shows the "Scheduled jobs" card with a row per job, and `e2e/operations.spec.ts` is extended to assert it, including the failed and stale states.
6. Nothing sends: with the gates as they are, a full local run leaves `communication_outbox` unchanged and no provider call is made.
7. `npm run check` passes and the unit total does not drop.

## 11. Files this task owns

- the new migration under `supabase/migrations/`
- its pgTAP test under `supabase/tests/`
- `src/hub/features/operations/OperationsPage.tsx` and the operations read API it uses
- `e2e/operations.spec.ts`
- `docs/care-reminders.md` and `docs/deployment-runbook.md` (the commissioning section)
- one ADR recording the §2 choice, with the rejected alternative and its reason

## 12. Not verified here, and open questions

- **Hosted `pg_cron` / `pg_net` availability and plan**: verified locally against this project's image; the hosted check is §9 step 1. Supabase documents the pattern and states `pg_cron` ships on current plans, but this contract does not claim it for this project's plan until step 1 is run.
- **The batch semantics of each worker** (how many items one call processes) were read only at the level needed to justify the cadences in §3. The implementer must confirm no worker needs a tighter loop; `dispatch-outbox/index.ts` contains a `for` loop and should be checked.
- **Invocation cost** (§3) assumes the cadences above and no extra scheduling.
- **Open question for the owner:** is 15 minutes the right reminder cadence for this practice, or should it be 5? It changes invocations, not behaviour, and it is a one-line change later.

---

## 13. Implementation notes (2026-09-22)

Written after the migration was built and tested, and recorded here rather than
left in a commit message. Three things differ from the design above; two are
deliberate and one bound a defect found by testing.

1. **The missing-credential path records and warns; it does not raise.** §4 said
   the job "records a receipt row and raises". That is impossible in one
   transaction: the raise rolls back the receipt that makes the failure visible.
   The implementation records the receipt, emits a `WARNING` for the database log
   and returns `configuration_missing`. The ops card is the visibility surface
   the map asks for, and it reads that table.

2. **Two append-only tables, not one mutable one.** §5 described a single
   `scheduler_job_runs`. The repository's existing scheduler evidence
   (`reminder_scheduler_runs`, `reminder_scheduler_results`) is append-only, with
   an immutability trigger and no client access at all. Reconcile now **inserts**
   an outcome into `scheduler_job_results` instead of updating a request row,
   which keeps both tables immutable and consistent with the existing evidence
   discipline. Reads go through an admin-gated definer function,
   `scheduler_job_status()`.

3. **Unconfigured receipts are bounded to one an hour per job.** Testing found
   that recording every attempt writes a receipt per minute, for as long as the
   project stays unconfigured — unbounded growth for no new information. The
   card needs to know the job is failing, not how many times it failed while
   nobody was watching. `configuration_missing` is therefore recorded at most
   hourly per job, while every attempt still warns.

Verified at implementation: `supabase db reset` replays all 137 migrations from
empty, the new test passes 26 assertions, and the full database suite passes
(111 files, 4,521 tests).
