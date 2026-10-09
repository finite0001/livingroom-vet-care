begin;create extension if not exists pgtap with schema extensions;set local search_path=public,extensions;select no_plan();

-- 20260928150000: one canonical appointment path, email appointment reminders
-- chosen from preference + consent, and a per-order lab reminder switch.

insert into auth.users(id,email,raw_user_meta_data) values('af000000-0000-4000-8000-000000000001','pipeline-admin@example.test','{"first_name":"Pipeline","last_name":"Admin"}');
update public.profiles set is_active=true where id='af000000-0000-4000-8000-000000000001';
insert into public.user_roles(user_id,role) values('af000000-0000-4000-8000-000000000001','STAFF'),('af000000-0000-4000-8000-000000000001','ADMIN') on conflict do nothing;
create temp table pipeline_fixture(kind text primary key,id uuid);grant all on pipeline_fixture to authenticated,service_role;
create function pg_temp.reminder_channels(p_appointment uuid) returns text language sql as $$
 select string_agg(distinct channel,',' order by channel) from public.appointment_reminders where appointment_id=p_appointment and status='PENDING'
$$;

-- Canonical path: the retired outbound_deliveries enqueue is inert and unreachable.
select ok(not has_function_privilege('service_role','public.enqueue_due_appointment_reminders(integer,timestamp with time zone)','EXECUTE'),'Retired reminder enqueue is not service-callable');
select ok(not has_function_privilege('authenticated','public.enqueue_due_appointment_reminders(integer,timestamp with time zone)','EXECUTE'),'Retired reminder enqueue is not staff-callable');
select ok(not has_function_privilege('service_role','public.process_due_reminders()','EXECUTE'),'Retired Lovable reminder reader is not service-callable');
select throws_ok($$select * from public.enqueue_due_appointment_reminders(1,now())$$,'0A000',null,'Retired reminder enqueue raises for its owner');
select ok(obj_description('public.enqueue_due_appointment_reminders(integer,timestamptz)'::regprocedure,'pg_proc') like 'DEPRECATED%','Retired enqueue is labelled deprecated');
select ok(has_function_privilege('service_role','public.queue_due_reminders(integer)','EXECUTE'),'Canonical queue stays service-callable');
select ok(not has_function_privilege('authenticated','public.queue_due_reminders(integer)','EXECUTE'),'Canonical queue stays closed to staff');
select ok(pg_get_constraintdef((select oid from pg_constraint where conrelid='public.scheduler_job_runs'::regclass and contype='c' limit 1)) like '%queue-reminders%','Scheduler dispatches the canonical queue-reminders worker');
select ok(not has_function_privilege('authenticated','public.appointment_reminder_channel(uuid)','EXECUTE') and not has_function_privilege('service_role','public.appointment_reminder_channel(uuid)','EXECUTE'),'Channel resolver is internal');

set local role authenticated;select set_config('request.jwt.claims','{"sub":"af000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
-- Households: email preferred; SMS preferred with consent; SMS preferred without consent;
-- email preferred without an email; no contact at all; voice preferred with SMS consent.
insert into pipeline_fixture select 'email-pref',id from public.save_client(auth.uid(),null,null,'Email','Pref','+13035550201','email-pref@example.test','EMAIL',null,null);
insert into pipeline_fixture select 'sms-pref',id from public.save_client(auth.uid(),null,null,'Sms','Pref','+13035550202','sms-pref@example.test','SMS',null,null);
insert into pipeline_fixture select 'sms-noconsent',id from public.save_client(auth.uid(),null,null,'Sms','NoConsent','+13035550203','sms-noconsent@example.test','SMS',null,null);
insert into pipeline_fixture select 'email-missing',id from public.save_client(auth.uid(),null,null,'Email','Missing','+13035550204','fixture-5949@example.test','EMAIL',null,null);
insert into pipeline_fixture select 'unreachable',id from public.save_client(auth.uid(),null,null,'No','Contact','+13035557493','fixture-7493@example.test','EMAIL',null,null);
insert into pipeline_fixture select 'voice-pref',id from public.save_client(auth.uid(),null,null,'Voice','Pref','+13035550206','voice-pref@example.test','VOICE',null,null);
select lives_ok($$select public.record_sms_consent(auth.uid(),(select id from pipeline_fixture where kind='sms-pref'),'+13035550202',true,'WRITTEN','Synthetic written consent',null)$$,'SMS consent for SMS-preferring household');
select lives_ok($$select public.record_sms_consent(auth.uid(),(select id from pipeline_fixture where kind='email-missing'),'+13035550204',true,'WRITTEN','Synthetic written consent',null)$$,'SMS consent for household without email');
select lives_ok($$select public.record_sms_consent(auth.uid(),(select id from pipeline_fixture where kind='voice-pref'),'+13035550206',true,'WRITTEN','Synthetic written consent',null)$$,'SMS consent for voice-preferring household');
insert into pipeline_fixture select 'pet-'||k,(public.save_patient(null,(select id from pipeline_fixture where kind=k),null,'Pet '||k,'Dog',null,null,'unknown',null,'unknown','unknown',null,null,null)).id
 from unnest(array['email-pref','sms-pref','sms-noconsent','email-missing','unreachable','voice-pref']) k;
-- Simulate historical contact-incomplete rows that predate the new guards.
-- Privileged setup only; schema is restored immediately and the whole test rolls back.
reset role;
alter table public.clients disable trigger client_required_contacts;
alter table public.clients drop constraint clients_required_contacts_check;
update public.clients set primary_email=null where id=(select id from pipeline_fixture where kind='email-missing');
update public.clients set primary_phone=null,primary_email=null where id=(select id from pipeline_fixture where kind='unreachable');
alter table public.clients add constraint clients_required_contacts_check check(public.client_contacts_complete(primary_phone,primary_email)) not valid;
alter table public.clients enable trigger client_required_contacts;
set local role authenticated;
insert into pipeline_fixture select 'appt-'||k,(public.save_appointment(auth.uid(),null,null,(select id from pipeline_fixture where kind=k),(select id from pipeline_fixture where kind='pet-'||k),now()+interval '3 days'+(n*interval '2 hours'),30,'Synthetic exam','SCHEDULED',auth.uid(),'clinic','2619 Spruce Street, Boulder, CO',0,0,null,'',array[48,24])).id
 from unnest(array['email-pref','sms-pref','sms-noconsent','email-missing','unreachable','voice-pref']) with ordinality u(k,n);

select is(pg_temp.reminder_channels((select id from pipeline_fixture where kind='appt-email-pref')),'EMAIL','Email-preferring household gets email appointment reminders');
select is(pg_temp.reminder_channels((select id from pipeline_fixture where kind='appt-sms-pref')),'SMS','SMS-preferring consented household gets text reminders');
select is(pg_temp.reminder_channels((select id from pipeline_fixture where kind='appt-sms-noconsent')),'EMAIL','Without SMS consent the reminder falls back to email, never an unconsented text');
select is(pg_temp.reminder_channels((select id from pipeline_fixture where kind='appt-email-missing')),'SMS','Without an email the reminder uses the consented SMS channel');
select is(pg_temp.reminder_channels((select id from pipeline_fixture where kind='appt-unreachable')),'EMAIL','With no consented channel the preferred channel is kept for queue-time checks');
select is(pg_temp.reminder_channels((select id from pipeline_fixture where kind='appt-voice-pref')),'SMS','Voice preference falls back to the consented SMS channel');
select is((select count(*) from public.appointment_reminders where appointment_id=(select id from pipeline_fixture where kind='appt-email-pref') and status='PENDING'),2::bigint,'Both reviewed offsets are created once on the chosen channel');

-- Email opt-out is honoured at booking: the suppressed address is never chosen.
reset role;
insert into public.communication_suppressions(channel,recipient,reason) values('EMAIL','email-pref@example.test','Synthetic unsubscribe');
set local role authenticated;select set_config('request.jwt.claims','{"sub":"af000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select lives_ok($$select public.record_sms_consent(auth.uid(),(select id from pipeline_fixture where kind='email-pref'),'+13035550201',true,'WRITTEN','Synthetic written consent',null)$$,'Email-preferring household later consents to texts');
select lives_ok($$select public.save_appointment(auth.uid(),(select id from pipeline_fixture where kind='appt-email-pref'),1,(select id from pipeline_fixture where kind='email-pref'),(select id from pipeline_fixture where kind='pet-email-pref'),now()+interval '3 days'+interval '2 hours',30,'Synthetic exam','SCHEDULED',auth.uid(),'clinic','2619 Spruce Street, Boulder, CO',0,0,null,'',array[48,24])$$,'Revision re-resolves the channel');
select is(pg_temp.reminder_channels((select id from pipeline_fixture where kind='appt-email-pref')),'SMS','Suppressed email moves the revision to the consented SMS channel');
select is((select count(*) from public.appointment_reminders where appointment_id=(select id from pipeline_fixture where kind='appt-email-pref') and appointment_version=1 and status='SKIPPED'),2::bigint,'Previous revision reminders are superseded, not re-sent');

-- Canonical handoff of an email appointment reminder into communication_outbox.
select lives_ok($$select public.save_care_message_template('af100000-0000-4000-8000-000000000001',null,'Reviewed appointment email','email',0,'{{patient_name}}: {{care_name}} on {{due_date}}',true,'Synthetic reviewed wording')$$,'Email appointment wording reviewed');
select lives_ok($$select public.save_reminder_automation_policy('af300000-0000-4000-8000-000000000001',null,'appointment','EMAIL','af100000-0000-4000-8000-000000000001',1,'Your upcoming visit',true,'Synthetic email appointment automation')$$,'Email appointment policy enabled');
reset role;
update public.appointment_reminders set remind_at=remind_at-interval '3 days' where appointment_id=(select id from pipeline_fixture where kind='appt-sms-noconsent') and status='PENDING';
set local role service_role;select set_config('request.jwt.claims','{"role":"service_role"}',true);
select is((public.queue_due_reminders(25)->>'queued')::integer,2,'Due email appointment reminders are queued by the canonical scheduler');
reset role;
select is((select count(*) from public.reminder_outbox_links h join public.appointment_reminders ar on ar.id=h.job_id join public.communication_outbox o on o.id=h.outbox_id
 where h.job_kind='appointment' and ar.appointment_id=(select id from pipeline_fixture where kind='appt-sms-noconsent') and o.channel='EMAIL' and o.recipient='sms-noconsent@example.test' and o.subject='Your upcoming visit' and o.state='pending'),2::bigint,'Outbox rows carry email channel, recipient and reviewed subject');
select is((select count(*) from public.outbound_deliveries od join public.appointment_reminders ar on ar.id=od.appointment_reminder_id where ar.appointment_id=(select id from pipeline_fixture where kind='appt-sms-noconsent')),0::bigint,'Canonical path writes nothing to outbound_deliveries');
select is((select count(*) from public.appointment_reminders where appointment_id=(select id from pipeline_fixture where kind='appt-sms-noconsent') and outbound_delivery_id is not null),0::bigint,'Canonical path never sets the legacy outbound link');
set local role service_role;select set_config('request.jwt.claims','{"role":"service_role"}',true);
select is((public.queue_due_reminders(25)->>'queued')::integer,0,'Repeat scheduler tick does not duplicate email appointment reminders');

-- Lab reminder switch.
set local role authenticated;select set_config('request.jwt.claims','{"sub":"af000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select lives_ok($$select public.save_care_message_template('af100000-0000-4000-8000-000000000002',null,'Reviewed lab email','email',0,'{{patient_name}}: {{care_name}} due {{due_date}}',true,'Synthetic reviewed wording')$$,'Lab wording reviewed');
select lives_ok($$select public.save_reminder_automation_policy('af300000-0000-4000-8000-000000000002',null,'lab','EMAIL','af100000-0000-4000-8000-000000000002',1,'Lab work due',true,'Synthetic lab automation')$$,'Lab policy enabled');
select lives_ok($$select public.save_patient_lab_order('af200000-0000-4000-8000-000000000001',(select id from pipeline_fixture where kind='pet-sms-pref'),null,jsonb_build_object('test_name','Synthetic panel','status','planned','due_date',(now() at time zone 'America/Denver')::date),'')$$,'Lab order saved without the switch');
select is((select reminders_enabled from public.patient_lab_orders where id='af200000-0000-4000-8000-000000000001'),false,'Lab reminders default off, like vaccine due plans');
set local role service_role;select set_config('request.jwt.claims','{"role":"service_role"}',true);
reset role;select is((select count(*) from public.reminder_scheduler_candidates_internal() where source_id='af200000-0000-4000-8000-000000000001'),0::bigint,'Disabled lab order is not a scheduler candidate');
select is((select count(*) from public.list_care_reminder_candidates((now() at time zone 'America/Denver')::date) where source_id='af200000-0000-4000-8000-000000000001'),0::bigint,'Disabled lab order is not a discovery candidate');
select throws_ok($$select public.enqueue_care_reminder(gen_random_uuid(),'lab','af200000-0000-4000-8000-000000000001',1,'af100000-0000-4000-8000-000000000002',1)$$,'PT409','Lab due source is not current or enabled','Disabled lab order cannot be enqueued directly');
set local role authenticated;select set_config('request.jwt.claims','{"sub":"af000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select throws_ok($$select public.save_patient_lab_order('af200000-0000-4000-8000-000000000002',(select id from pipeline_fixture where kind='pet-sms-pref'),null,'{"test_name":"No due date","status":"planned","reminders_enabled":true}','')$$,'23514','Set a lab due date before enabling reminders','Enabling requires a due date');
select throws_ok($$select public.save_patient_lab_order('af200000-0000-4000-8000-000000000002',(select id from pipeline_fixture where kind='pet-sms-pref'),null,'{"test_name":"Bad switch","status":"planned","due_date":"2030-01-01","reminders_enabled":"yes"}','')$$,'23514','Invalid lab order fields','Switch must be a JSON boolean');
select lives_ok($$select public.save_patient_lab_order('af200000-0000-4000-8000-000000000001',(select id from pipeline_fixture where kind='pet-sms-pref'),1,jsonb_build_object('test_name','Synthetic panel','status','planned','due_date',(now() at time zone 'America/Denver')::date,'reminders_enabled',true),'')$$,'Staff enable reminders for this order');
select is((select version from public.patient_lab_orders where id='af200000-0000-4000-8000-000000000001'),2,'Enabling is a versioned lab order revision');
select is((select snapshot->>'reminders_enabled' from public.lab_work_revisions where entity='order' and entity_id='af200000-0000-4000-8000-000000000001' and version=2),'true','Revision history records the switch');
select lives_ok($$select public.save_patient_lab_order('af200000-0000-4000-8000-000000000001',(select id from pipeline_fixture where kind='pet-sms-pref'),1,jsonb_build_object('test_name','Synthetic panel','status','planned','due_date',(now() at time zone 'America/Denver')::date,'reminders_enabled',true),'')$$,'Exact retry is idempotent');
select is((select version from public.patient_lab_orders where id='af200000-0000-4000-8000-000000000001'),2,'Exact retry adds no revision');
select lives_ok($$select public.save_patient_lab_order('af200000-0000-4000-8000-000000000001',(select id from pipeline_fixture where kind='pet-sms-pref'),2,jsonb_build_object('test_name','Synthetic panel','status','ordered','due_date',(now() at time zone 'America/Denver')::date),'')$$,'Save that omits the switch');
select is((select reminders_enabled from public.patient_lab_orders where id='af200000-0000-4000-8000-000000000001'),true,'Omitting the switch keeps the stored choice');
set local role service_role;select set_config('request.jwt.claims','{"role":"service_role"}',true);
reset role;select is((select count(*) from public.reminder_scheduler_candidates_internal() where source_id='af200000-0000-4000-8000-000000000001'),1::bigint,'Enabled lab order becomes a scheduler candidate');
select is((public.queue_due_reminders(25)->>'queued')::integer,1,'Enabled lab order is queued through the canonical outbox');
select is((select count(*) from public.care_reminder_jobs where source_id='af200000-0000-4000-8000-000000000001' and status='pending'),1::bigint,'One care job exists for the enabled order');
-- Disabling after queueing blocks the pending handoff at the provider preflight.
insert into pipeline_fixture select 'lab-outbox',h.outbox_id from public.reminder_outbox_links h join public.care_reminder_jobs j on j.id=h.job_id where h.job_kind='care' and j.source_id='af200000-0000-4000-8000-000000000001';
set local role authenticated;select set_config('request.jwt.claims','{"sub":"af000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select lives_ok($$select public.save_patient_lab_order('af200000-0000-4000-8000-000000000001',(select id from pipeline_fixture where kind='pet-sms-pref'),3,jsonb_build_object('test_name','Synthetic panel','status','ordered','due_date',(now() at time zone 'America/Denver')::date,'reminders_enabled',false),'')$$,'Staff turn reminders off');
reset role;
select is((select status from public.care_reminder_jobs where source_id='af200000-0000-4000-8000-000000000001'),'invalidated','Turning reminders off invalidates the pending job');
set local role service_role;select set_config('request.jwt.claims','{"role":"service_role"}',true);
-- Claim every pending handoff (two appointment emails, then the lab email).
do $$begin for i in 1..3 loop perform public.claim_communication();end loop;end $$;
select is((select state from public.communication_outbox where id=(select id from pipeline_fixture where kind='lab-outbox')),'claimed','Queued lab handoff can still be claimed');
select is((select state from public.start_communication_attempt((select id from pipeline_fixture where kind='lab-outbox'),(select lease_token from public.communication_outbox where id=(select id from pipeline_fixture where kind='lab-outbox')),'{}'::jsonb)),'failed','Provider preflight refuses a lab reminder switched off after queueing');
select is((public.queue_due_reminders(25)->>'queued')::integer,0,'Switched-off order is not re-queued');
-- Leaving an open status clears the switch.
set local role authenticated;select set_config('request.jwt.claims','{"sub":"af000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select lives_ok($$select public.save_patient_lab_order('af200000-0000-4000-8000-000000000003',(select id from pipeline_fixture where kind='pet-sms-pref'),null,jsonb_build_object('test_name','Collected panel','status','collected','due_date','2030-01-01','collected_date',(now() at time zone 'America/Denver')::date,'reminders_enabled',true),'')$$,'Closed-status order accepts the field');
select is((select reminders_enabled from public.patient_lab_orders where id='af200000-0000-4000-8000-000000000003'),false,'Only planned or ordered lab orders can keep reminders on');

select * from finish();
rollback;
