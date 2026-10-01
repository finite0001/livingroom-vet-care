-- Scheduler follow-up (2026-09-30 linkage audit, items B3 and B12).
--
-- B3. The scheduler's pg_net timeout was 5 s. Queue workers now process a
--     bounded batch per call (up to 25 items within a 20 s budget, see
--     supabase/functions/_shared/worker-batch.ts), and a single provider call
--     can legitimately take several seconds, so a 5 s timeout recorded healthy
--     batches as "request timed out" on the ops card. The timeout is raised to
--     30 s, which stays above the worker budget so an ordinary batch answers
--     before pg_net gives up. scheduler_dispatch is otherwise unchanged from
--     20260922120000_b1_scheduler.sql, its only previous definition.
--
-- B12. purge_expired_frozen_email_payloads (which runs both
--     purge_expired_release_email_payloads and purge_expired_invoice_email_payloads)
--     was documented as "a production daily operator/scheduled call is still
--     required" but nothing ever called it. It is now on the timetable once a
--     day. It is safe to run unattended: it only clears payload bytes older than
--     90 days for abandoned requests or provider-accepted/delivered sends with a
--     receipt, never pending, failed or uncertain sends; it keeps the manifest,
--     hashes and audit rows; it is bounded (100 rows per family per call) and
--     uses SKIP LOCKED. It runs in the database, so it does not go through
--     scheduler_dispatch (no HTTP, no Vault secret, no scheduler_job_runs row);
--     its outcome is in cron.job_run_details.
--
--     This is not apply_retention_policies(), which must never be scheduled
--     (B1 contract section 7). The b1 test asserts no cron command mentions
--     "retention"; the job below does not.

create or replace function public.scheduler_dispatch(p_job text) returns jsonb
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
    -- Recorded at most once an hour per job; see 20260922120000_b1_scheduler.sql.
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

  -- 30 s: above the workers' 20 s batch budget (B3).
  _request_id := net.http_post(
    url := _project_url || '/functions/v1/' || p_job,
    headers := jsonb_build_object('apikey', _worker_key, 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000);

  insert into public.scheduler_job_runs(job, url_path, request_id)
    values (p_job, '/functions/v1/' || p_job, _request_id) returning id into _run_id;

  return jsonb_build_object('job', p_job, 'outcome', 'dispatched', 'request_id', _request_id, 'run_id', _run_id);
end $$;

revoke all on function public.scheduler_dispatch(text) from public,anon,authenticated,service_role;

-- The purge functions authorize with communication_require_service(), which
-- reads auth.role() from request.jwt.claims. A cron job runs as the database
-- owner with no claims, so this wrapper supplies the service role claim for
-- the duration of the call only and restores the previous value. It is
-- callable by no client role.
create function public.scheduler_purge_expired_email_payloads() returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  _previous text := current_setting('request.jwt.claims', true);
  _round jsonb;
  _releases integer := 0;
  _invoices integer := 0;
  _rounds integer := 0;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  -- Each call purges at most 100 rows per family. Repeat while a family filled
  -- its batch, bounded so one daily run cannot hold the job open indefinitely.
  loop
    _round := public.purge_expired_frozen_email_payloads(100);
    _rounds := _rounds + 1;
    _releases := _releases + (_round->>'record_release_payloads')::integer;
    _invoices := _invoices + (_round->>'invoice_payloads')::integer;
    exit when _rounds >= 20
      or ((_round->>'record_release_payloads')::integer < 100 and (_round->>'invoice_payloads')::integer < 100);
  end loop;
  perform set_config('request.jwt.claims', coalesce(_previous, ''), true);
  return jsonb_build_object('record_release_payloads', _releases, 'invoice_payloads', _invoices, 'rounds', _rounds);
end $$;

revoke all on function public.scheduler_purge_expired_email_payloads() from public,anon,authenticated,service_role;

-- Same pg_cron database guard as the B1 timetable: clones and scratch
-- databases used by the concurrency harnesses skip it.
do $$
declare
  _cron_database text := coalesce(current_setting('cron.database_name', true), 'postgres');
begin
  if current_database() <> _cron_database then
    raise notice 'Email payload purge job not created in %: pg_cron schedules in % only. This database is a clone or a scratch database.',
      current_database(), _cron_database;
    return;
  end if;

  create extension if not exists pg_cron;

  -- 09:17 UTC daily (03:17 Mountain in summer, 02:17 in winter): outside clinic hours.
  perform cron.schedule('purge-expired-email-payloads', '17 9 * * *',
    $cmd$select public.scheduler_purge_expired_email_payloads()$cmd$);
end $$;
