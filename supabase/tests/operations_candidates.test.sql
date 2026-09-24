begin;create extension if not exists pgtap with schema extensions;set local search_path=public,extensions;select no_plan();
insert into auth.users(id,email,raw_user_meta_data) values('ae000000-0000-4000-8000-000000000001','reminder-approver@example.test','{"first_name":"Reminder","last_name":"Approver"}'),('ae000000-0000-4000-8000-000000000002','reminder-staff@example.test','{"first_name":"Reminder","last_name":"Staff"}');
update public.profiles set is_active = true where id in ('ae000000-0000-4000-8000-000000000001','ae000000-0000-4000-8000-000000000002');
insert into public.user_roles (user_id, role) values ('ae000000-0000-4000-8000-000000000001','STAFF'),('ae000000-0000-4000-8000-000000000002','STAFF');

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

set local role authenticated;select set_config('request.jwt.claims','{"sub":"ae000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
insert into reminder_fixture select 'product',id from save_catalog_product(null,null,'Synthetic exact vaccine','vaccine','','dose',100,true);
select save_vaccine_due_template('ae100000-0000-4000-8000-000000000008',null,'operations-vaccine','Synthetic reviewed group',array[(select id from reminder_fixture where kind='product')],30,true,'Synthetic reviewed interval');
select save_patient_vaccine_due_plan('ae200000-0000-4000-8000-000000000008',(select id from reminder_fixture where kind='pet'),null,'ae100000-0000-4000-8000-000000000008',1,(select id from reminder_fixture where kind='product'),null,(now() at time zone 'America/Denver')::date-30,'Synthetic paper record',30,(now() at time zone 'America/Denver')::date,'current',true,'','Synthetic reviewed plan');
select save_reminder_automation_policy('ae300000-0000-4000-8000-000000000008',null,'vaccine','EMAIL','ae100000-0000-4000-8000-000000000001',1,'Synthetic vaccine reminder',true,'Synthetic policy');
select save_care_message_template('ae100000-0000-4000-8000-000000000009',null,'Synthetic appointment wording','sms',0,'{{patient_name}}: {{care_name}} on {{due_date}}',true,'Synthetic reviewed wording');
select save_reminder_automation_policy('ae300000-0000-4000-8000-000000000009',null,'appointment','SMS','ae100000-0000-4000-8000-000000000009',1,'',true,'Synthetic policy');
insert into reminder_fixture select 'appointment',id from save_appointment(auth.uid(),null,null,(select id from reminder_fixture where kind='client'),(select id from reminder_fixture where kind='pet'),now()+interval '4 hours',30,'Synthetic exam','SCHEDULED',auth.uid(),'clinic','2619 Spruce Street',0,0,null,'',array[2]);
reset role;update appointment_reminders set remind_at=now()-interval '1 minute' where appointment_id=(select id from reminder_fixture where kind='appointment');
select is((select count(*) from reminder_scheduler_candidates_internal()),3::bigint,'Vaccine, lab and appointment candidates retained');
select is((select jsonb_agg(to_jsonb(c) order by job_kind,source_kind,source_id,policy_id) from public.reminder_scheduler_candidates_internal() c),(select jsonb_agg(to_jsonb(c) order by job_kind,source_kind,source_id,policy_id) from pg_temp.legacy_candidates() c),'All three source branches match original canonical candidate identities');
set local role authenticated;
insert into data select 'first',operations_reminder_candidates(null,1);
select is((select v->>'has_more' from data where k='first'),'true','Candidate page advertises more without inventing job ids');
select is(jsonb_array_length(operations_reminder_candidates((select v#>>'{items,0,cursor_key}' from data where k='first'),100)->'items'),2,'Candidate cursor reaches remaining sources exactly');
select ok(operations_overview()#>>'{reminders,oldest_candidate_at}' is not null,'Overview derives actual eligibility time');
select save_reminder_automation_policy('ae300000-0000-4000-8000-000000000008',1,'vaccine','EMAIL','ae100000-0000-4000-8000-000000000001',1,'Synthetic vaccine reminder',false,'Disabled reviewed policy');
reset role;
select is((select count(*) from reminder_scheduler_candidates_internal()),2::bigint,'Disabled source policy remains excluded');
select is((select jsonb_agg(to_jsonb(c) order by job_kind,source_kind,source_id,policy_id) from public.reminder_scheduler_candidates_internal() c),(select jsonb_agg(to_jsonb(c) order by job_kind,source_kind,source_id,policy_id) from pg_temp.legacy_candidates() c),'Disabled policy predicate preserved');
update appointment_reminders set remind_at=now()+interval '1 hour' where appointment_id=(select id from reminder_fixture where kind='appointment');
select is((select count(*) from reminder_scheduler_candidates_internal()),1::bigint,'Future appointment reminder excluded');
set local role authenticated;
select save_care_message_template('ae100000-0000-4000-8000-000000000001',1,'Reviewed reminder','email',0,'{{patient_name}}: {{care_name}} due {{due_date}}',true,'New reviewed wording version');
reset role;
select is((select count(*) from reminder_scheduler_candidates_internal()),0::bigint,'Old policy cannot schedule a newly versioned template');
select is((select jsonb_agg(to_jsonb(c) order by job_kind,source_kind,source_id,policy_id) from public.reminder_scheduler_candidates_internal() c),(select jsonb_agg(to_jsonb(c) order by job_kind,source_kind,source_id,policy_id) from pg_temp.legacy_candidates() c),'Version and time exclusions match original query');
select * from finish();rollback;
