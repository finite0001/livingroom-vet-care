-- 2026-09-30 scheduler follow-up: the pg_net timeout stays above the worker
-- batch budget, and expired frozen email payload bytes are purged daily by a
-- job no client role can invoke.

begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

-- B3: timeout raised above the 20 s worker budget; nothing else about dispatch changed.
select ok(pg_get_functiondef('public.scheduler_dispatch(text)'::regprocedure) like '%timeout_milliseconds := 30000%',
  'Scheduler posts with a 30 s timeout, above the 20 s worker batch budget');
select ok(pg_get_functiondef('public.scheduler_dispatch(text)'::regprocedure) not like '%timeout_milliseconds := 5000%',
  'The 5 s timeout is gone');
select is((public.scheduler_dispatch('dispatch-outbox'))->>'outcome','configuration_missing',
  'Redefined dispatch still fails visibly when Vault is unconfigured');
select ok(not has_function_privilege('authenticated','public.scheduler_dispatch(text)','execute'),
  'Staff still cannot dispatch a job by hand');
select ok(not has_function_privilege('service_role','public.scheduler_dispatch(text)','execute'),
  'service_role still cannot dispatch a job by hand');

-- B12: the purge is on the timetable, daily, and is not the retention job.
select is((select schedule from cron.job where jobname='purge-expired-email-payloads'), '17 9 * * *',
  'Expired email payload purge runs once a day');
select is((select command from cron.job where jobname='purge-expired-email-payloads'),
  'select public.scheduler_purge_expired_email_payloads()', 'The purge job calls only the bounded wrapper');
select is((select count(*)::int from cron.job where command ilike '%retention%'), 0,
  'apply_retention_policies is still not on the timetable');

select ok(not has_function_privilege('anon','public.scheduler_purge_expired_email_payloads()','execute'),
  'anon cannot run the purge wrapper');
select ok(not has_function_privilege('authenticated','public.scheduler_purge_expired_email_payloads()','execute'),
  'Staff cannot run the purge wrapper');
select ok(not has_function_privilege('service_role','public.scheduler_purge_expired_email_payloads()','execute'),
  'service_role cannot run the purge wrapper directly');

-- Runs as the cron owner with no JWT claims, and leaves no service-role claim behind.
select set_config('request.jwt.claims', '', true);
select is((public.scheduler_purge_expired_email_payloads())->>'rounds', '1',
  'The wrapper authorizes the service-only purge without request claims and stops when nothing is left');
select is(coalesce(current_setting('request.jwt.claims', true), ''), '',
  'The temporary service-role claim is restored afterwards');

select * from finish();
rollback;
