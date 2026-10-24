-- B1: prove the scheduler is installed, cannot be turned on by accident, fails
-- visibly when it is unconfigured, and records what actually happened.
--
-- The behaviours that matter here are the ones that are invisible in normal use:
-- an unconfigured scheduler must not look calm, an accepted-looking request must
-- be distinguishable from a refused one, and the retention job must never be on
-- the timetable.

begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

-- 1. The timetable.
select is(
  (select count(*)::int from cron.job
    where jobname in ('dispatch-outbox','process-inbound','process-stripe-events',
                      'queue-reminders','cleanup-abandoned-attachment','scheduler-reconcile')),
  6, 'All six scheduler jobs are scheduled');
select is((select schedule from cron.job where jobname='queue-reminders'), '*/15 * * * *',
  'Reminders run every fifteen minutes, not every minute');
select is((select schedule from cron.job where jobname='cleanup-abandoned-attachment'), '*/30 * * * *',
  'Attachment cleanup runs every thirty minutes');
select is((select count(*)::int from cron.job where command ilike '%retention%'), 0,
  'apply_retention_policies is not on the timetable and must never be added');

-- 2. Evidence is append-only and unreadable by clients.
select ok(not has_table_privilege('anon','public.scheduler_job_runs','select'),
  'The request receipts are not readable by anon');
select ok(not has_table_privilege('authenticated','public.scheduler_job_runs','select'),
  'The request receipts are not readable directly by staff');
select ok(not has_table_privilege('service_role','public.scheduler_job_results','select'),
  'The outcomes are not readable directly by service_role');

insert into public.scheduler_job_runs(job,url_path) values ('cleanup-abandoned-attachment','/functions/v1/cleanup-abandoned-attachment');
select throws_ok($$update public.scheduler_job_runs set job='process-inbound'$$,
  '23514','Scheduler run evidence is append-only','Request evidence cannot be rewritten');
select throws_ok($$delete from public.scheduler_job_runs$$,
  '23514','Scheduler run evidence is append-only','Request evidence cannot be deleted');

-- 3. Unconfigured means visible, not silent. A fresh database has no Vault secrets.
--    The cron jobs are live while this runs, so these assertions are about the
--    call's own receipt rather than a global row count.
select is((public.scheduler_dispatch('dispatch-outbox'))->>'outcome','configuration_missing',
  'An unconfigured scheduler records a failure rather than posting');
select is(
  (select count(*)::int from public.scheduler_job_results s
     join public.scheduler_job_runs r on r.id = s.run_id
    where r.job = 'dispatch-outbox' and s.outcome = 'configuration_missing'),
  1,
  'The failure is recorded once, not once per attempt');
select is((public.scheduler_dispatch('dispatch-outbox'))->>'outcome','configuration_missing',
  'A second attempt is still reported as unconfigured');
select is(
  (select count(*)::int from public.scheduler_job_results s
     join public.scheduler_job_runs r on r.id = s.run_id
    where r.job = 'dispatch-outbox' and s.outcome = 'configuration_missing'),
  1,
  'The second attempt adds no receipt: evidence is bounded to one an hour per job');
select is((select count(*)::int from public.scheduler_job_runs where request_id is not null),0,
  'Nothing was posted while unconfigured');
select throws_ok($$select public.scheduler_dispatch('not-a-worker')$$,
  '22023',null,'An unknown job name is refused');

-- 4. Reconciliation: net.http_post is asynchronous, so the outcome is read back
--    from the response table. A 2xx is success; anything else is a failure.
--
--    The scheduler-reconcile job is live while this test runs and may answer
--    these rows first, so the assertions are about the recorded outcome rather
--    than about which call did the work.
insert into public.scheduler_job_runs(job,url_path,request_id)
  values ('process-inbound','/functions/v1/process-inbound',4242),
         ('process-stripe-events','/functions/v1/process-stripe-events',4243);
insert into net._http_response(id,status_code,content_type,headers,content,timed_out,error_msg)
  values (4242,202,'application/json','{}'::jsonb,'{}',false,null),
         (4243,401,'application/json','{}'::jsonb,'{}',false,null);

select ok(public.scheduler_reconcile() <= 2, 'Reconcile answers no more requests than are outstanding');
select is((select outcome from public.scheduler_job_results s join public.scheduler_job_runs r on r.id=s.run_id where r.request_id=4242),
  'ok','A 2xx response is recorded as ok');
select is((select status_code from public.scheduler_job_results s join public.scheduler_job_runs r on r.id=s.run_id where r.request_id=4242),
  202,'The response status is kept');
select is((select outcome from public.scheduler_job_results s join public.scheduler_job_runs r on r.id=s.run_id where r.request_id=4243),
  'failed','A 401 from a refused or rotated key is recorded as a failure');
select is(public.scheduler_reconcile(),0,'Reconciling twice changes nothing');

-- 5. The ops read path is admin-gated.
insert into auth.users(id,email,raw_user_meta_data) values
  ('b1000000-0000-4000-8000-000000000001','b1-admin@example.test','{}'),
  ('b1000000-0000-4000-8000-000000000002','b1-staff@example.test','{}');
update public.profiles set is_active=true
  where id in ('b1000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000002');
insert into public.user_roles(user_id,role) values
  ('b1000000-0000-4000-8000-000000000001','STAFF'),
  ('b1000000-0000-4000-8000-000000000001','ADMIN'),
  ('b1000000-0000-4000-8000-000000000002','STAFF');

set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"b1000000-0000-4000-8000-000000000002"}',true);

select throws_ok($$select public.operations_scheduler_jobs()$$,'42501',null,
  'A non-admin staff member cannot read scheduler status');
select throws_ok($$select public.scheduler_dispatch('dispatch-outbox')$$,'42501',null,
  'A staff member cannot dispatch a job by hand');
select throws_ok($$select public.scheduler_reconcile()$$,'42501',null,
  'A staff member cannot run reconciliation');

select set_config('request.jwt.claims','{"role":"authenticated","sub":"b1000000-0000-4000-8000-000000000001"}',true);
select is((public.operations_scheduler_jobs())->>'observed_at' is not null,true,
  'An admin receives a scheduler status reading');
select is(
  (select j->>'outcome' from jsonb_array_elements((public.operations_scheduler_jobs())->'jobs') j where j->>'job'='dispatch-outbox'),
  'configuration_missing','The admin reading shows the unconfigured job as failed');
select is(
  (select j->>'stale' from jsonb_array_elements((public.operations_scheduler_jobs())->'jobs') j where j->>'job'='process-inbound'),
  'false','A job that just ran is not reported as stale');

select * from finish();
rollback;
