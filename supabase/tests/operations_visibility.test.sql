begin;create extension if not exists pgtap with schema extensions;set local search_path=public,extensions;select no_plan();
insert into auth.users(id,email,raw_user_meta_data) values('ae000000-0000-4000-8000-000000000001','reminder-approver@example.test','{"first_name":"Reminder","last_name":"Approver"}'),('ae000000-0000-4000-8000-000000000002','reminder-staff@example.test','{"first_name":"Reminder","last_name":"Staff"}');
insert into public.user_roles(user_id,role) values('ae000000-0000-4000-8000-000000000001','ADMIN') on conflict do nothing;
create temp table reminder_fixture(kind text primary key,id uuid);grant all on reminder_fixture to authenticated,service_role;
select ok(not has_function_privilege('authenticated','public.queue_due_reminders(integer)','EXECUTE'),'Staff cannot call service queue');
select ok(not has_function_privilege('service_role','public.start_communication_attempt_without_reminder_guard(uuid,uuid,jsonb)','EXECUTE'),'Service cannot bypass final reminder guard');
select ok(not has_function_privilege('authenticated','public.block_reminder_job(text,uuid,text)','EXECUTE'),'Internal blocker is not staff-callable');
select ok(not has_table_privilege('service_role','public.reminder_outbox_links','UPDATE'),'Service cannot rewrite frozen origin');
set local role authenticated;select set_config('request.jwt.claims','{"sub":"ae000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
insert into reminder_fixture select 'client',id from public.save_client(auth.uid(),null,null,'Synthetic','Reminder','+13035550111','synthetic-reminder@example.test','EMAIL',null,null);
insert into reminder_fixture select 'pet',id from public.save_patient(null,(select id from reminder_fixture where kind='client'),null,'Juniper','Dog',null,null,'unknown',null,'unknown','unknown',null,null,null);
select lives_ok($$select public.save_care_message_template('ae100000-0000-4000-8000-000000000001',null,'Reviewed reminder','email',0,'{{patient_name}}: {{care_name}} due {{due_date}}',true,'Clinical wording reviewed')$$,'Approved care wording exists before policy');
select lives_ok($$select public.save_patient_lab_order('ae200000-0000-4000-8000-000000000001',(select id from reminder_fixture where kind='pet'),null,jsonb_build_object('test_name','Synthetic lab','status','planned','due_date',(now() at time zone 'America/Denver')::date),'')$$,'Eligible native source exists');
set local role service_role;select set_config('request.jwt.claims','{"role":"service_role"}',true);
select is((public.queue_due_reminders(25)->>'queued')::integer,0,'No seeded enabled policy means no automatic queue');
set local role authenticated;select set_config('request.jwt.claims','{"sub":"ae000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select lives_ok($$select public.save_reminder_automation_policy('ae300000-0000-4000-8000-000000000001',null,'lab','EMAIL','ae100000-0000-4000-8000-000000000001',1,'Reviewed care reminder',false,'Reviewed but disabled')$$,'Policy explicitly begins disabled');
set local role service_role;select set_config('request.jwt.claims','{"role":"service_role"}',true);
select is((public.queue_due_reminders(25)->>'queued')::integer,0,'Disabled policy cannot create outbox entries');
set local role authenticated;select set_config('request.jwt.claims','{"sub":"ae000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select lives_ok($$select public.save_reminder_automation_policy('ae300000-0000-4000-8000-000000000001',1,'lab','EMAIL','ae100000-0000-4000-8000-000000000001',1,'Reviewed care reminder',true,'Explicit synthetic enable for test')$$,'Administrator can explicitly enable reviewed policy');

reset role;
create temp table data(k text primary key,v jsonb);grant all on data to authenticated,service_role;
create temp table fx(k text primary key,id uuid);grant all on fx to authenticated,service_role;
insert into fx select k,gen_random_uuid() from unnest(array['run','unresolved','failedrun','checkrun']) k;
create function pg_temp.legacy_candidates() returns table(job_kind text,job_id uuid,policy_id uuid,source_id uuid,source_kind text,source_version integer,template_id uuid,template_version integer) language sql stable security definer set search_path=public as $$
 select x.* from (
  select 'care'::text job_kind,j.id job_id,p.id policy_id,v.id source_id,'vaccine'::text source_kind,v.version source_version,t.id template_id,t.version template_version
  from public.reminder_automation_policies p join public.care_message_templates t on t.id=p.message_template_id and t.version=p.message_template_version and t.active
  join public.patient_vaccine_due_plans v on p.source_kind='vaccine' and v.status='current' and v.reminders_enabled and v.current_due_on<=(now() at time zone 'America/Denver')::date+t.days_before
  left join public.care_reminder_jobs j on j.source_kind='vaccine' and j.source_id=v.id and j.source_version=v.version and j.message_template_id=t.id and j.message_template_version=t.version
  where p.enabled and exists(select 1 from public.pets patient where patient.id=v.pet_id and patient.archived_at is null and patient.deceased_at is null) and (j.id is null or j.status='pending') and not exists(select 1 from public.reminder_outbox_links h where h.job_kind='care' and h.job_id=j.id)
  union all
  select 'care',j.id,p.id,l.id,'lab',l.version,t.id,t.version
  from public.reminder_automation_policies p join public.care_message_templates t on t.id=p.message_template_id and t.version=p.message_template_version and t.active
  join public.patient_lab_orders l on p.source_kind='lab' and l.status in ('planned','ordered') and l.due_date<=(now() at time zone 'America/Denver')::date+t.days_before
  left join public.care_reminder_jobs j on j.source_kind='lab' and j.source_id=l.id and j.source_version=l.version and j.message_template_id=t.id and j.message_template_version=t.version
  where p.enabled and exists(select 1 from public.pets patient where patient.id=l.pet_id and patient.archived_at is null and patient.deceased_at is null) and (j.id is null or j.status='pending') and not exists(select 1 from public.reminder_outbox_links h where h.job_kind='care' and h.job_id=j.id)
  union all
  select 'appointment',ar.id,p.id,a.id,'appointment',a.version,t.id,t.version
  from public.reminder_automation_policies p join public.care_message_templates t on t.id=p.message_template_id and t.version=p.message_template_version and t.active
  join public.appointment_reminders ar on p.source_kind='appointment' and ar.channel=p.channel and ar.status='PENDING' and ar.remind_at<=now()
  join public.appointments a on a.id=ar.appointment_id and a.version=ar.appointment_version and a.status in ('SCHEDULED','CONFIRMED') and a.scheduled_at>now()
  where p.enabled and not exists(select 1 from public.reminder_outbox_links h where h.job_kind='appointment' and h.job_id=ar.id)
 ) x order by x.job_kind,x.source_kind,x.source_id
$$;
select is((select jsonb_agg(to_jsonb(c) order by job_kind,source_kind,source_id,policy_id) from public.reminder_scheduler_candidates_internal() c),(select jsonb_agg(to_jsonb(c) order by job_kind,source_kind,source_id,policy_id) from pg_temp.legacy_candidates() c),'Extracted candidate identities exactly match original query');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"ae000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is(operations_overview()#>>'{reminders,candidate_count}','1','Backlog includes source without preexisting care job');
select ok(operations_reminder_candidates()#>'{items,0,job_id}'='null'::jsonb,'Uncreated care job is labeled null');
select is(operations_reminder_candidates()#>>'{items,0,source_kind}','lab','Safe candidate source kind');
select ok(operations_overview()#>'{reminders,last_run}'='null'::jsonb,'No recorded scheduler run remains unknown');
select throws_ok($$select start_reminder_scheduler_run((select id from fx where k='run'),25)$$,'42501',null,'Administrator cannot author service scheduler evidence');
select throws_ok($$select reminder_scheduler_candidates_internal()$$,'42501',null,'Private candidate helper not directly callable');
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select throws_ok($$select execute_reminder_scheduler_run((select id from fx where k='run'))$$,'42501',null,'Cannot execute before confirmed start');
insert into data select 'start',start_reminder_scheduler_run((select id from fx where k='run'),25);
select is(start_reminder_scheduler_run((select id from fx where k='run'),25),(select v from data where k='start'),'Exact start retry preserves server timestamp');
select throws_ok($$select start_reminder_scheduler_run((select id from fx where k='run'),24)$$,'23505',null,'Start UUID cannot change requested limit');
select is(recover_reminder_scheduler_run((select id from fx where k='run'))->>'outcome','started','Started receipt is unresolved, not zero work');
insert into data select 'complete',execute_reminder_scheduler_run((select id from fx where k='run'));
select is((select v->>'outcome' from data where k='complete'),'completed','Atomic wrapper records queue completion');
select is((select v#>>'{counts,queued}' from data where k='complete'),'1','Durable result stores actual queue count');
select is(recover_reminder_scheduler_run((select id from fx where k='run')),(select v from data where k='complete'),'Lost execution acknowledgment recovered without queue');
select start_reminder_scheduler_run((select id from fx where k='unresolved'),25);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"ae000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is(operations_overview()#>>'{reminders,unresolved_runs}','1','Unresolved start visible independently of completed run');
select ok(operations_overview()#>>'{reminders,last_completed_at}' is not null,'Last completed evidence visible');
select is(operations_scheduler_runs(null,null,1)->>'has_more','true','Run history bounded with continuation');
select is(operations_outbox('pending')#>>'{items,0,state}','pending','Global pending outbox visibility');
select ok(not(operations_outbox('pending')#>'{items,0}' ?| array['recipient','body','lease_token','provider_config']),'Outbox projection excludes private content and credentials');
select public.save_patient_lab_order('ae200000-0000-4000-8000-000000000003',(select id from reminder_fixture where kind='pet'),null,jsonb_build_object('test_name','Future separate candidate','status','planned','due_date',(now() at time zone 'America/Denver')::date),'');
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select is(execute_reminder_scheduler_run((select id from fx where k='run')),(select v from data where k='complete'),'Exact completed replay never queues newly eligible work');
reset role;
select is((select count(*) from public.communication_outbox where client_id=(select id from reminder_fixture where kind='client')),1::bigint,'Completed replay has no second outbox side effect');
update public.communication_outbox set state='uncertain',last_error='Private upstream text must not escape' where client_id=(select id from reminder_fixture where kind='client');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"ae000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is(operations_outbox('uncertain')#>>'{items,0,reason}','processing_review_required','Raw upstream error replaced by safe review code');
select public.suppress_communication(auth.uid(),'EMAIL','synthetic-reminder@example.test','Synthetic suppression');
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select queue_due_reminders(25);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"ae000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is(operations_reminder_blocks()#>>'{items,0,reason}','reminder_handoff_blocked','Blocked handoff does not expose frozen context or free text');
reset role;
-- Test-only fault inside the canonical queue function. Both this override and fixture writes roll back.
create temp table fault_write(id integer);grant all on fault_write to service_role;
create or replace function public.queue_due_reminders(p_limit integer default 25) returns jsonb language plpgsql security definer set search_path=public as $$begin insert into pg_temp.fault_write values(1);raise exception 'Synthetic queue failure with private content';end $$;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select start_reminder_scheduler_run((select id from fx where k='failedrun'),25);
insert into data select 'failed',execute_reminder_scheduler_run((select id from fx where k='failedrun'));
select is((select v->>'outcome' from data where k='failed'),'failed','Definitive SQL rollback can record failed outcome');
select is((select v->>'failure_code' from data where k='failed'),'queue_transaction_rolled_back','Failure evidence is safe typed code');
select is((select count(*) from fault_write),0::bigint,'Failed transaction leaves no partial queue writes');
select is(execute_reminder_scheduler_run((select id from fx where k='failedrun')),(select v from data where k='failed'),'Failed terminal replay never runs queue again');
select start_reminder_scheduler_run((select id from fx where k='checkrun'),1);
reset role;
select throws_ok($$insert into reminder_scheduler_results(run_id,outcome) values((select id from fx where k='checkrun'),'completed')$$,'23514',null,'NULL completed counts rejected even in privileged fixture');
select throws_ok($$insert into reminder_scheduler_results(run_id,outcome) values((select id from fx where k='checkrun'),'failed')$$,'23514',null,'NULL failure evidence rejected');
select throws_ok($$update reminder_scheduler_runs set requested_limit=1$$,'23514',null,'Run start evidence immutable');
select throws_ok($$delete from reminder_scheduler_results$$,'23514',null,'Terminal evidence immutable');
-- More than100 later completed callbacks must not hide older quarantined work.
insert into stripe_event_receipts(id,event_id,event_type,provider_created_at,account_id,livemode,object_id,raw_sha256,received_disposition,received_reason,disposition,reason,created_at)
select gen_random_uuid(),'evt_operations'||i,'checkout.session.completed',1,'acct_operationsfixture',false,'cs_operations_'||i,repeat('a',64),'queued','','queued','',now()-make_interval(secs=>i) from generate_series(1,105) i;
insert into stripe_event_work(receipt_id,state,reason) select id,'completed','' from stripe_event_receipts where account_id='acct_operationsfixture';
insert into stripe_event_receipts(id,event_id,event_type,provider_created_at,account_id,livemode,object_id,raw_sha256,received_disposition,received_reason,disposition,reason,created_at)
values(gen_random_uuid(),'evt_operationsold','checkout.session.completed',1,'acct_operationsfixture',false,'cs_operations_old',repeat('a',64),'quarantined','unattributed_provider_object','quarantined','unattributed_provider_object',now()-interval '2 days');
insert into stripe_event_work(receipt_id,state,reason) select id,'quarantined','unattributed_provider_object' from stripe_event_receipts where event_id='evt_operationsold';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"ae000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is(read_stripe_event_queue_page()#>>'{items,0,event_id}','evt_operationsold','Old unfinished callback discoverable beyond completed100');
insert into data select 'stripepage',read_stripe_event_queue_page('completed',null,null,100);
select is(jsonb_array_length((select v->'items' from data where k='stripepage')),100,'Completed page bounded100');
select is((select v->>'has_more' from data where k='stripepage'),'true','Completed page advertises continuation');
select is(jsonb_array_length(read_stripe_event_queue_page('completed',(select (v#>>'{items,99,created_at}')::timestamptz from data where k='stripepage'),(select (v#>>'{items,99,id}')::uuid from data where k='stripepage'),100)->'items'),5,'Cursor reaches remaining completed rows without duplicate');
select ok(not(read_stripe_event_queue_page()#>'{items,0}' ? 'lease_token'),'Stripe page excludes worker lease');
select throws_ok($$select operations_outbox('pending',null,null,101)$$,'23514',null,'Unbounded outbox page denied');
select throws_ok($$select operations_scheduler_runs(now(),null,10)$$,'23514',null,'Partial run cursor denied');
select set_config('request.jwt.claims','{"sub":"ae000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select throws_ok($$select operations_overview()$$,'42501',null,'Nonadministrator overview denied');
select throws_ok($$select operations_outbox()$$,'42501',null,'Nonadministrator outbox denied');
select throws_ok($$select read_stripe_event_queue_page()$$,'42501',null,'Nonadministrator Stripe discovery denied');
reset role;select set_config('request.jwt.claims','{"sub":"ae000000-0000-4000-8000-000000000001","role":"authenticated"}',true);update profiles set is_active=false where id='ae000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"ae000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select throws_ok($$select operations_reminder_candidates()$$,'42501',null,'Inactive administrator denied');
set local role anon;
select throws_ok($$select operations_overview()$$,'42501',null,'Anonymous operational data denied');
select * from finish();rollback;
