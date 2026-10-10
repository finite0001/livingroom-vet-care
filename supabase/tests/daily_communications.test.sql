begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email,raw_user_meta_data) values('a5520000-0000-4000-8000-000000000001','daily-staff@example.test','{}');
update profiles set is_active=true,full_name='Synthetic daily staff' where id='a5520000-0000-4000-8000-000000000001';
insert into user_roles(user_id,role) values('a5520000-0000-4000-8000-000000000001','STAFF');
create temp table fx(k text primary key,id uuid);create temp table data(k text primary key,v jsonb);grant all on fx,data to authenticated;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a5520000-0000-4000-8000-000000000001","role":"authenticated"}',true);
insert into fx select 'client',id from save_client(auth.uid(),null,null,'Synthetic','Daily household','+12025550139','daily-client@example.test','EMAIL',null,null);
insert into fx select 'pet',id from save_patient(null,(select id from fx where k='client'),null,'Synthetic daily dog','Dog',null,null,'unknown',null,'unknown','unknown',null,null,null);
reset role;
with inserted as (insert into conversations(client_id) values((select id from fx where k='client')) returning id) insert into fx select 'conversation',id from inserted;
with inserted as (insert into messages(conversation_id,content,type,sender_type,sender_id,is_internal) values((select id from fx where k='conversation'),'PRIVATE CAPABILITY MUST NOT APPEAR','EMAIL','STAFF','a5520000-0000-4000-8000-000000000001',false) returning id) insert into fx select 'message',id from inserted;
with inserted as (insert into communication_outbox(request_id,conversation_id,client_id,message_id,created_by,created_at,channel,recipient,subject,body,provider,state,accepted_at,attempt_count,provider_config)
values(gen_random_uuid(),(select id from fx where k='conversation'),(select id from fx where k='client'),(select id from fx where k='message'),'a5520000-0000-4000-8000-000000000001','2026-03-08T07:00:00Z','EMAIL','daily-client@example.test','PRIVATE SUBJECT','PRIVATE CAPABILITY MUST NOT APPEAR','resend','accepted','2026-03-08T07:02:00Z',2,'{"secret":"PRIVATE CONFIG"}') returning id) insert into fx select 'outbox',id from inserted;
insert into communication_attempts(outbox_id,lease_token,attempt_number,started_at,finished_at,outcome,error_code) values
 ((select id from fx where k='outbox'),gen_random_uuid(),1,'2026-03-08T07:00:00Z','2026-03-08T07:01:00Z','failed','PRIVATE ERROR'),
 ((select id from fx where k='outbox'),gen_random_uuid(),2,'2026-03-09T05:59:59Z','2026-03-09T06:00:01Z','accepted',null);
-- Exact message association is deduplicated. Same recipient alone is not evidence of duplication.
insert into outbound_deliveries(idempotency_key,channel,recipient,client_id,conversation_id,message_id,scheduled_at)
values('daily-duplicate','EMAIL','daily-client@example.test',(select id from fx where k='client'),(select id from fx where k='conversation'),(select id from fx where k='message'),'2026-03-08T07:00:00Z');
with inserted as (insert into outbound_deliveries(idempotency_key,channel,recipient,client_id,conversation_id,message_id,scheduled_at)
values('daily-independent','SMS','+12025550139',(select id from fx where k='client'),(select id from fx where k='conversation'),(select id from fx where k='message'),'2026-03-08T07:00:00Z') returning id) insert into fx select 'legacy',id from inserted;
-- Protected document association supplies the exact patient without exposing its capability.
with inserted as (insert into record_releases(id,pet_id,client_id,channel,recipient,selection,snapshot,source_hash,request,created_by)
 values(gen_random_uuid(),(select id from fx where k='pet'),(select id from fx where k='client'),'SMS','+12025550139','{}','{}',repeat('a',64),'{}','a5520000-0000-4000-8000-000000000001') returning id)
 insert into fx select 'release',id from inserted;
with inserted as (insert into document_link_grants(id,family,source_id,client_id,actor_id,conversation_id,recipient,source_hash,source_bundle,message_template,origin,key_version,capability_context,expires_at)
 values(gen_random_uuid(),'record_release',(select id from fx where k='release'),(select id from fx where k='client'),'a5520000-0000-4000-8000-000000000001',(select id from fx where k='conversation'),'+12025550139',repeat('a',64),'{"secret":"PRIVATE BUNDLE"}','{{document_link}}','https://example.test','synthetic','PRIVATE CAPABILITY',now()+interval '1 day') returning id)
 insert into fx select 'grant',id from inserted;
insert into document_link_outbox_links(outbox_id,grant_id,reviewed_artifact_hash,reviewed_message_hash,queued_by)
 values((select id from fx where k='outbox'),(select id from fx where k='grant'),repeat('a',64),repeat('b',64),'a5520000-0000-4000-8000-000000000001');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a5520000-0000-4000-8000-000000000001","role":"authenticated"}',true);
insert into data values('page',list_daily_communications('2026-03-08','2026-03-08'));
select is(jsonb_array_length((select v->'rows' from data where k='page')),2,'Canonical message plus independent retained delivery; exact legacy duplicate suppressed');
select is((select v#>>'{rows,0,source}' from data where k='page'),'outbox','Most recent attempt orders message');
select is((select v#>>'{rows,0,status}' from data where k='page'),'accepted','Acceptance remains distinct from delivered');
select is((select v#>>'{rows,0,activity_at}' from data where k='page'),'2026-03-09T05:59:59+00:00','Calendar date includes final second of Denver DST day');
select is((select v#>>'{rows,0,attempt_count}' from data where k='page'),'2','Two attempts do not become two messages');
select is((select v#>>'{rows,0,pet_id}' from data where k='page'),(select id::text from fx where k='pet'),'Protected record link retains exact patient association');
select is((select v#>>'{rows,0,summary}' from data where k='page'),'Protected document link','Safe document family label instead of capability text');
select ok((select v::text from data where k='page') not like '%PRIVATE%','No body, subject, provider config or raw errors exposed');
select is(jsonb_array_length(list_daily_communications('2026-03-08','2026-03-08',p_channel=>'EMAIL')->'rows'),1,'Server channel filter');
select is(jsonb_array_length(list_daily_communications('2026-03-08','2026-03-08',p_status=>'delivered')->'rows'),0,'Accepted is not delivered');
select is(jsonb_array_length(list_daily_communications('2026-03-08','2026-03-08',p_search=>'Daily household')->'rows'),2,'Client filter');
select is(jsonb_array_length(list_daily_communications('2026-03-08','2026-03-08',p_search=>'Nonexistent')->'rows'),0,'Nonmatching filter');
insert into data values('first',list_daily_communications('2026-03-08','2026-03-08',p_limit=>1));
select ok((select v->'next'<>'null'::jsonb from data where k='first'),'Server supplies keyset continuation');
insert into data values('second',list_daily_communications('2026-03-08','2026-03-08',p_before=>(select v->'next' from data where k='first'),p_limit=>1));
select isnt((select v#>>'{rows,0,id}' from data where k='first'),(select v#>>'{rows,0,id}' from data where k='second'),'No duplicate on next page');
select is((select v->'next' from data where k='second'),'null'::jsonb,'Last page explicit');
insert into data values('detail',read_daily_communication('outbox',(select id from fx where k='outbox')));
select is(jsonb_array_length((select v->'attempts' from data where k='detail')),2,'Individual attempts available as history');
select ok((select v::text from data where k='detail') not like '%PRIVATE%','Attempt history also excludes raw errors and capabilities');
select is(read_daily_communication('legacy',(select id from fx where k='legacy'))#>>'{record,source}','legacy','Retained identity readable');
select is(read_daily_communication('outbox',gen_random_uuid()),null::jsonb,'Unavailable identity returns null');
select throws_ok($$select daily_communication_rows_internal()$$,'42501',null,'Internal reader not directly executable by staff');
select throws_ok($$select list_daily_communications('2026-03-09','2026-03-08')$$,'23514',null,'Reversed range rejected');
select throws_ok($$select list_daily_communications('infinity','infinity')$$,'23514',null,'Infinite range rejected');
select throws_ok($$select list_daily_communications('2026-01-01','2027-01-02')$$,'23514',null,'Unbounded date range rejected');
select throws_ok($$select list_daily_communications(p_limit=>101)$$,'23514',null,'Oversize page rejected');
select throws_ok($$select list_daily_communications(p_status=>'sent')$$,'23514',null,'Ambiguous sent status rejected');
select throws_ok($$select list_daily_communications(p_before=>'{}')$$,'23514',null,'Malformed cursor rejected');
-- Scheduled and blocked jobs remain distinct from actual accepted/delivered evidence.
reset role;
with inserted as (insert into care_message_templates(id,name,channel,days_before,body,review_note,updated_by)
 values(gen_random_uuid(),'Synthetic reminder','email',0,'PRIVATE TEMPLATE','Synthetic test','a5520000-0000-4000-8000-000000000001') returning id)
 insert into fx select 'template',id from inserted;
with inserted as (insert into reminder_automation_policies(id,source_kind,channel,message_template_id,message_template_version,subject,enabled,review_note,approved_by)
 values(gen_random_uuid(),'vaccine','EMAIL',(select id from fx where k='template'),1,'Synthetic',false,'Synthetic disabled policy','a5520000-0000-4000-8000-000000000001') returning id)
 insert into fx select 'policy',id from inserted;
insert into fx select k,gen_random_uuid() from unnest(array['care_pending','care_blocked','appointment','appointment_pending','appointment_skipped','appointment_sent','suppressed_message','suppressed_outbox','accepted_message','accepted_outbox']) k;
insert into care_reminder_jobs(id,source_kind,source_id,source_version,pet_id,client_id,message_template_id,message_template_version,channel,scheduled_on,due_on,rendered_body,source_snapshot,template_snapshot)
 select id,'vaccine',gen_random_uuid(),1,(select id from fx where k='pet'),(select id from fx where k='client'),(select id from fx where k='template'),1,'email','2026-03-10','2026-03-10','PRIVATE BODY','{}','{}' from fx where k in ('care_pending','care_blocked');
insert into reminder_outbox_links(job_kind,job_id,policy_id,policy_version,state,reason)
 values('care',(select id from fx where k='care_blocked'),(select id from fx where k='policy'),1,'blocked','PRIVATE BLOCK REASON');
insert into appointments(id,client_id,pet_id,scheduled_at,appointment_type,assigned_dvm_id)
 values((select id from fx where k='appointment'),(select id from fx where k='client'),(select id from fx where k='pet'),'2026-03-12T18:00:00Z','Synthetic visit','a5520000-0000-4000-8000-000000000001');
insert into appointment_reminders(id,appointment_id,remind_at,channel,status)
 select id,(select id from fx where k='appointment'),'2026-03-10T18:00:00Z'::timestamptz+case k when 'appointment_pending' then interval '0 hours' when 'appointment_skipped' then interval '1 hour' else interval '2 hours' end,'EMAIL',case k when 'appointment_pending' then 'PENDING'::reminder_status when 'appointment_skipped' then 'SKIPPED'::reminder_status else 'SENT'::reminder_status end
 from fx where k in ('appointment_pending','appointment_skipped','appointment_sent');
insert into messages(id,conversation_id,content,type,sender_type,sender_id,is_internal)
 select id,(select id from fx where k='conversation'),'PRIVATE CAPABILITY','EMAIL','STAFF','a5520000-0000-4000-8000-000000000001',false from fx where k in ('suppressed_message','accepted_message');
insert into communication_outbox(id,request_id,conversation_id,client_id,message_id,created_by,created_at,channel,recipient,subject,body,provider,state,last_error)
 values((select id from fx where k='suppressed_outbox'),gen_random_uuid(),(select id from fx where k='conversation'),(select id from fx where k='client'),(select id from fx where k='suppressed_message'),'a5520000-0000-4000-8000-000000000001','2026-03-10T18:00:00Z','EMAIL','daily-client@example.test','Synthetic','PRIVATE BODY','resend','failed','recipient_or_actor_ineligible');
insert into communication_outbox(id,request_id,conversation_id,client_id,message_id,created_by,created_at,channel,recipient,subject,body,provider,state,first_attempt_at,accepted_at,provider_message_id)
 values((select id from fx where k='accepted_outbox'),gen_random_uuid(),(select id from fx where k='conversation'),(select id from fx where k='client'),(select id from fx where k='accepted_message'),'a5520000-0000-4000-8000-000000000001','2026-03-10T18:00:00Z','EMAIL','daily-client@example.test','Synthetic','PRIVATE BODY','resend','accepted','2026-03-10T18:00:00Z','2026-03-10T18:01:00Z','daily-provider-identity');
insert into outbound_deliveries(idempotency_key,channel,recipient,client_id,conversation_id,scheduled_at,provider,provider_message_id)
 values('daily-provider-duplicate','EMAIL','daily-client@example.test',(select id from fx where k='client'),(select id from fx where k='conversation'),'2026-03-10T18:00:00Z','resend','daily-provider-identity');
insert into reminder_outbox_links(job_kind,job_id,policy_id,policy_version,outbox_id,approving_actor_id,frozen_context,state,invalidated_at,reason)
 values('appointment',(select id from fx where k='appointment_sent'),(select id from fx where k='policy'),1,(select id from fx where k='accepted_outbox'),'a5520000-0000-4000-8000-000000000001','{}','queued',now(),'PRIVATE AFTER-START INVALIDATION');
set local role authenticated;
select is(read_daily_communication('care',(select id from fx where k='care_pending'))#>>'{record,status}','scheduled','Future care job is scheduled, not promised delivery');
select is(read_daily_communication('care',(select id from fx where k='care_pending'))#>>'{record,source_href}','/hub/tools/care-reminders','Care job links to actual care-reminder workflow');
select is(read_daily_communication('care',(select id from fx where k='care_blocked'))#>>'{record,status}','suppressed','Blocked job is explicitly suppressed');
select is(read_daily_communication('appointment',(select id from fx where k='appointment_pending'))#>>'{record,status}','scheduled','Appointment job visible before enqueue');
select is(read_daily_communication('appointment',(select id from fx where k='appointment_skipped'))#>>'{record,status}','suppressed','Skipped reminder is suppressed');
select is(read_daily_communication('appointment',(select id from fx where k='appointment_sent')),null::jsonb,'Canonical association replaces separate appointment job row');
select is(read_daily_communication('outbox',(select id from fx where k='suppressed_outbox'))#>>'{record,status}','suppressed','Final preflight rejection shown as suppressed');
select is(read_daily_communication('outbox',(select id from fx where k='accepted_outbox'))#>>'{record,status}','accepted','Invalidation after attempt start does not erase provider acceptance');
select is(jsonb_array_length(list_daily_communications('2026-03-10','2026-03-10')->'rows'),6,'Provider identity deduplicated and canonical job not repeated');
select is(jsonb_array_length(list_daily_communications('2026-03-10','2026-03-10',p_search=>'daily dog')->'rows'),5,'Patient filter includes explicit job/release associations only, not every household message');
select ok(list_daily_communications('2026-03-10','2026-03-10')::text not like '%PRIVATE%','All reminder projections redact raw capabilities and errors');
reset role;
delete from reminder_outbox_links where job_id=(select id from fx where k='appointment_sent');
set local role authenticated;
select is(read_daily_communication('appointment',(select id from fx where k='appointment_sent'))#>>'{record,status}','uncertain','Historical sent marker alone does not prove delivery or provider acceptance');

-- Updating delivery state does not move its attempt-day identity.
reset role;
update communication_outbox set state='delivered',delivered_at='2026-03-10T18:00:00Z',updated_at='2026-03-10T18:00:00Z' where id=(select id from fx where k='outbox');
set local role authenticated;
select is(jsonb_array_length(list_daily_communications('2026-03-08','2026-03-08',p_status=>'delivered')->'rows'),1,'Late delivery visible on original activity day');
select is(jsonb_array_length(list_daily_communications('2026-03-10','2026-03-10',p_status=>'delivered')->'rows'),0,'Callback timestamp does not invent a second send');
reset role;
select set_config('request.jwt.claims','{}',true);
update profiles set is_active=false where id='a5520000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a5520000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select throws_ok($$select list_daily_communications()$$,'42501',null,'Inactive staff denied');
select throws_ok($$select read_daily_communication('outbox',(select id from fx where k='outbox'))$$,'42501',null,'Inactive detail denied');
set local role anon;
select throws_ok($$select list_daily_communications()$$,'42501',null,'Anonymous list denied');
select throws_ok($$select read_daily_communication('outbox',gen_random_uuid())$$,'42501',null,'Anonymous detail denied');
reset role;
select * from finish();rollback;
