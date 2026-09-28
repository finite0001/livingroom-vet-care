-- Read-only scheduler health check (docs/scheduler.md). Safe to run at any time:
-- it opens a READ ONLY transaction, prints no secret value, and rolls back.
--
--   psql "$LRV_DB_URL" -X -f scripts/scheduler/verify-scheduler.sql

\set ON_ERROR_STOP on
begin transaction read only;

\echo '1. Vault secrets read by public.scheduler_dispatch (presence only)'
select n.name as secret,
       s.id is not null as present,
       s.updated_at
  from unnest(array['project_url', 'scheduler_worker_key']) as n(name)
  left join vault.secrets s on s.name = n.name
 order by n.name;

\echo '2. Each pg_cron job: last cron execution and last application receipt'
with last_cron as (
  select distinct on (d.jobid) d.jobid, d.status, d.start_time, d.return_message
    from cron.job_run_details d
   order by d.jobid, d.runid desc
), last_receipt as (
  select distinct on (r.job) r.job, r.requested_at, r.request_id,
         s.outcome, s.status_code, s.error_message
    from public.scheduler_job_runs r
    left join public.scheduler_job_results s on s.run_id = r.id
   order by r.job, r.requested_at desc, r.id desc
)
select j.jobname,
       j.schedule,
       j.active,
       c.status as cron_status,
       c.start_time as cron_last_run,
       left(c.return_message, 160) as cron_message,
       r.requested_at as receipt_at,
       case
         when r.job is null then null
         when r.outcome is null and r.request_id is not null then 'dispatched (awaiting reconcile)'
         else r.outcome
       end as receipt_outcome,
       r.status_code as http_status,
       left(r.error_message, 160) as receipt_error
  from cron.job j
  left join last_cron c on c.jobid = j.jobid
  left join last_receipt r on r.job = j.jobname
 order by j.jobname;

\echo '3. Latest reminder queue runs (queue-reminders -> queue_due_reminders)'
select r.run_id, r.started_at, s.outcome, s.queued, s.blocked, s.skipped, s.failure_code
  from public.reminder_scheduler_runs r
  left join public.reminder_scheduler_results s on s.run_id = r.run_id
 order by r.started_at desc
 limit 5;

rollback;
