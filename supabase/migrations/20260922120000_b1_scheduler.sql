-- B1: the scheduler. Design and rationale: plans/2026-09-21-scheduler/B1-contract.md.
--
-- Before this migration nothing in the product acted on its own: no migration
-- called cron.schedule, the database never called out, vercel.json had no crons
-- and no workflow was scheduled, while dispatch-outbox, queue-reminders,
-- process-inbound, process-stripe-events and cleanup-abandoned-attachment all
-- existed with nothing to invoke them. Queued mail never sent, reminders never
-- fired, inbound replies were never processed and Stripe events were never
-- applied.
--
-- Two decisions worth keeping in view:
--
--   * The caller credential lives in Supabase Vault, created by the owner at
--     commissioning. It is deliberately NOT in this migration, in a workflow or
--     in the repository: a key that can read every table does not belong in a
--     file that is replayed on every database in every environment.
--   * public.apply_retention_policies() is deliberately NOT scheduled here, and
--     must never be added. Its clock runs from the last message rather than the
--     patient's last exam, so as configured it can hard-delete client
--     communications belonging to a patient who is still being seen. See the
--     B1 contract section 7.
--
-- Nothing here switches the practice on. Every worker already fails closed:
-- queue-reminders returns "disabled" unless REMINDER_SCHEDULER_ENABLED is true
-- and APP_ENV is staging or production, and outbound delivery is gated by
-- OUTBOUND_DELIVERY_MODE. Installing the timetable is not enabling delivery.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 1. Request receipts. Append-only, like reminder_scheduler_runs, and readable
--    by no client role: the ops page reads them through the projection below.
create table public.scheduler_job_runs (
  id uuid primary key default gen_random_uuid(),
  job text not null,
  url_path text not null,
  request_id bigint,
  requested_at timestamptz not null default clock_timestamp(),
  check (job in ('dispatch-outbox','process-inbound','process-stripe-events','queue-reminders','cleanup-abandoned-attachment'))
);

create index scheduler_job_runs_cursor on public.scheduler_job_runs(requested_at desc, id desc);
create index scheduler_job_runs_unresolved on public.scheduler_job_runs(request_id) where request_id is not null;

-- 2. Outcomes. Also append-only: reconcile INSERTS the answer rather than
--    updating the request row, which is what keeps both tables immutable.
create table public.scheduler_job_results (
  run_id uuid primary key references public.scheduler_job_runs(id),
  outcome text not null check (outcome in ('ok','failed','configuration_missing')),
  status_code integer,
  error_message text,
  recorded_at timestamptz not null default clock_timestamp(),
  check (
    (outcome = 'ok' and status_code between 200 and 299 and error_message is null)
    or (outcome = 'failed')
    or (outcome = 'configuration_missing' and status_code is null and error_message is not null)
  )
);

do $$ declare t text; begin
  foreach t in array array['scheduler_job_runs','scheduler_job_results'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role', t);
    -- Reuses the operations evidence trigger: scheduler evidence is append-only.
    execute format('create trigger immutable_scheduler_evidence before update or delete on public.%I for each row execute function public.operations_run_immutable()', t);
  end loop;
end $$;

-- 3. Dispatch one job. Reads the credential from Vault at run time and posts.
--
--    A note on failure handling, because it differs from the contract's wording:
--    the contract says the missing-credential path "records a receipt row and
--    raises". That is impossible in one transaction - the raise would roll back
--    the very receipt that makes the failure visible. This records the receipt,
--    emits a WARNING for the database log, and returns the outcome. The ops card
--    is the visibility surface the map asks for, and it reads this table.
create function public.scheduler_dispatch(p_job text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare
  _project_url text;
  _worker_key text;
  _run_id uuid;
  _request_id bigint;
  _missing text;
begin
  if p_job is null or p_job not in ('dispatch-outbox','process-inbound','process-stripe-events','queue-reminders','cleanup-abandoned-attachment') then
    raise exception 'Unknown scheduler job' using errcode = '22023';
  end if;

  select decrypted_secret into _project_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into _worker_key from vault.decrypted_secrets where name = 'scheduler_worker_key';
  _missing := nullif(concat_ws(', ',
    case when _project_url is null then 'project_url' end,
    case when _worker_key is null then 'scheduler_worker_key' end), '');

  if _missing is not null then
    -- Record before returning, so an installed-but-unconfigured scheduler is
    -- visible rather than silent - but at most once an hour per job. Recording
    -- every attempt would write a receipt every minute for as long as the
    -- project stayed unconfigured, which is unbounded growth for no new
    -- information: the card needs to know that the job is failing, not how many
    -- times it failed while nobody was looking.
    if not exists (
      select 1 from public.scheduler_job_results s
        join public.scheduler_job_runs r on r.id = s.run_id
       where r.job = p_job
         and s.outcome = 'configuration_missing'
         and s.recorded_at > now() - interval '1 hour'
    ) then
      insert into public.scheduler_job_runs(job, url_path) values (p_job, '/functions/v1/' || p_job) returning id into _run_id;
      insert into public.scheduler_job_results(run_id, outcome, error_message)
        values (_run_id, 'configuration_missing', 'Missing Vault secret(s): ' || _missing);
    end if;
    raise warning 'scheduler job % is installed but not configured; missing Vault secret(s): %', p_job, _missing;
    return jsonb_build_object('job', p_job, 'outcome', 'configuration_missing', 'missing', _missing, 'run_id', _run_id);
  end if;

  _request_id := net.http_post(
    url := _project_url || '/functions/v1/' || p_job,
    headers := jsonb_build_object('apikey', _worker_key, 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 5000);

  -- Inserted after the post so the request id is known; the table is append-only.
  insert into public.scheduler_job_runs(job, url_path, request_id)
    values (p_job, '/functions/v1/' || p_job, _request_id) returning id into _run_id;

  return jsonb_build_object('job', p_job, 'outcome', 'dispatched', 'request_id', _request_id, 'run_id', _run_id);
end $$;

revoke all on function public.scheduler_dispatch(text) from public,anon,authenticated,service_role;

-- 4. Reconcile: net.http_post is asynchronous, so "did the worker accept it?" is
--    only answerable from the response table. Without this a 401 from a rotated
--    key is indistinguishable from success.
create function public.scheduler_reconcile() returns integer
language plpgsql security definer set search_path = public, extensions
as $$
declare _resolved integer;
begin
  with unresolved as (
    select r.id, r.request_id
      from public.scheduler_job_runs r
     where r.request_id is not null
       and not exists (select 1 from public.scheduler_job_results s where s.run_id = r.id)
  ), answered as (
    select u.id, resp.status_code, resp.error_msg, resp.timed_out
      from unresolved u
      join net._http_response resp on resp.id = u.request_id
  )
  insert into public.scheduler_job_results(run_id, outcome, status_code, error_message)
  select a.id,
         case when a.error_msg is null and not a.timed_out and a.status_code between 200 and 299 then 'ok' else 'failed' end,
         a.status_code,
         coalesce(a.error_msg, case when a.timed_out then 'request timed out' end)
    from answered a;
  get diagnostics _resolved = row_count;
  return _resolved;
end $$;

revoke all on function public.scheduler_reconcile() from public,anon,authenticated,service_role;

-- 5. Read path for the ops card. Admin-gated, like every other operations read.
create function public.operations_scheduler_jobs() returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare _items jsonb;
begin
  perform public.operations_require_admin();
  with latest as (
    select r.job, r.requested_at, r.id as run_id,
           row_number() over (partition by r.job order by r.requested_at desc, r.id desc) as rn
      from public.scheduler_job_runs r
  ), shaped as (
    select l.job, l.requested_at, s.outcome, s.status_code, s.error_message,
           case l.job when 'queue-reminders' then interval '15 minutes'
                      when 'cleanup-abandoned-attachment' then interval '30 minutes'
                      else interval '1 minute' end as cadence
      from latest l left join public.scheduler_job_results s on s.run_id = l.run_id
     where l.rn = 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'job', job,
           'requested_at', requested_at,
           'outcome', coalesce(outcome, 'dispatched'),
           'status_code', status_code,
           'error_message', error_message,
           'stale', requested_at < now() - (cadence * 3)
         ) order by job), '[]'::jsonb)
    into _items
    from shaped;
  return jsonb_build_object('observed_at', statement_timestamp(), 'jobs', _items);
end $$;

revoke all on function public.operations_scheduler_jobs() from public,anon,authenticated,service_role;
grant execute on function public.operations_scheduler_jobs() to authenticated;

-- 6. The timetable. cron.schedule updates a job that already carries the name, so
--    replaying this migration is idempotent.
select cron.schedule('dispatch-outbox', '* * * * *', $$select public.scheduler_dispatch('dispatch-outbox')$$);
select cron.schedule('process-inbound', '* * * * *', $$select public.scheduler_dispatch('process-inbound')$$);
select cron.schedule('process-stripe-events', '* * * * *', $$select public.scheduler_dispatch('process-stripe-events')$$);
select cron.schedule('queue-reminders', '*/15 * * * *', $$select public.scheduler_dispatch('queue-reminders')$$);
select cron.schedule('cleanup-abandoned-attachment', '*/30 * * * *', $$select public.scheduler_dispatch('cleanup-abandoned-attachment')$$);
select cron.schedule('scheduler-reconcile', '* * * * *', $$select public.scheduler_reconcile()$$);
