begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

select is(care_calendar_due('2026-01-31',1,'months','clamp'),'2026-02-28'::date,'Month clamps from original anchor');
select is(care_calendar_due('2026-01-31',1,'months','clamp',2),'2026-03-31'::date,'Fixed anchor avoids February drift');
select is(care_calendar_due('2024-02-29',1,'years','clamp'),'2025-02-28'::date,'Leap year clamps');
select is(care_calendar_due('2024-02-29',1,'years','clamp',4),'2028-02-29'::date,'Original leap-day anchor returns');
select is(care_calendar_due('2026-04-30',1,'months','preserve_end'),'2026-05-31'::date,'Reviewed month-end rule is explicit');
select is(care_calendar_due('2026-04-30',1,'months','clamp'),'2026-05-30'::date,'Clamp preserves original day rather than end');
select is(care_calendar_due('2026-03-01',2,'weeks','clamp'),'2026-03-15'::date,'Weeks are calendar days');
select throws_ok($$select care_date('"2026-02-29"')$$,'23514',null,'Invalid calendar date rejected');
select throws_ok($$select care_calendar_due('2026-01-01',0,'months','clamp')$$,'23514',null,'Zero interval rejected');
select throws_ok($$select care_calendar_due('9999-12-31',1,'days','clamp')$$,'23514',null,'Overflow rejected');
select is(care_window_next_open(480,1200,'2026-03-08T06:00Z'),'2026-03-08T14:00Z'::timestamptz,'Denver opening crosses spring DST safely');
select is(care_window_next_open(480,1200,'2026-11-01T04:00Z'),'2026-11-01T15:00Z'::timestamptz,'Denver opening crosses fall DST safely');
select is(care_window_next_open(480,1200,'2026-10-10T18:00Z'),'2026-10-10T18:00Z'::timestamptz,'Within reviewed window is immediately eligible');
select throws_ok($$select care_window_next_open(1200,480,now())$$,'23514',null,'Reversed window rejected');
select ok(not has_function_privilege('anon','list_patient_care_plans(uuid,uuid,integer)','EXECUTE'),'Anonymous list denied by ACL');
select ok(not has_function_privilege('service_role','save_patient_care_plan(uuid,uuid,uuid,integer,jsonb)','EXECUTE'),'Service cannot make clinical decisions');
select ok(not has_table_privilege('authenticated','care_workflow_actions','INSERT'),'Actions cannot be manufactured directly');
select ok(not has_function_privilege('authenticated','care_eligibility_lock()','EXECUTE'),'Eligibility helper is private');

insert into auth.users(id,email,raw_user_meta_data) values
 ('ac2b0000-0000-4000-8000-000000000001','care-dvm@example.test','{}'),
 ('ac2b0000-0000-4000-8000-000000000002','care-staff@example.test','{}'),
 ('ac2b0000-0000-4000-8000-000000000003','care-admin@example.test','{}');
update profiles set is_active=true,full_name='Synthetic care reviewer' where id in
 ('ac2b0000-0000-4000-8000-000000000001','ac2b0000-0000-4000-8000-000000000002','ac2b0000-0000-4000-8000-000000000003');
insert into user_roles(user_id,role) values
 ('ac2b0000-0000-4000-8000-000000000001','DVM'),('ac2b0000-0000-4000-8000-000000000001','ADMIN'),
 ('ac2b0000-0000-4000-8000-000000000002','STAFF'),('ac2b0000-0000-4000-8000-000000000003','ADMIN');
create temp table fx(k text primary key,id uuid);create temp table data(k text primary key,v jsonb);
grant all on fx,data to authenticated,service_role;
insert into fx select k,gen_random_uuid() from unnest(array['template','plan','save-default','save-plan','complete','service','source-correction','message-template','policy']) k;
insert into data values('default','{"care_key":"synthetic-monthly","name":"Synthetic monthly care","care_kind":"wellness","interval_amount":1,"interval_unit":"months","anchor_mode":"fixed_schedule","month_end":"clamp","active":true,"review_note":"Synthetic reviewed interval"}');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"ac2b0000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select throws_ok($$select save_recurring_care_template((select id from fx where k='save-default'),(select id from fx where k='template'),null,(select v from data where k='default'))$$,'42501',null,'Administrator alone cannot approve clinical defaults');
select set_config('request.jwt.claims','{"sub":"ac2b0000-0000-4000-8000-000000000001","role":"authenticated"}',true);
insert into data values('saved-default',save_recurring_care_template((select id from fx where k='save-default'),(select id from fx where k='template'),null,(select v from data where k='default')));
select is((select v->>'version' from data where k='saved-default'),'1','Named DVM approves one version');
select is(save_recurring_care_template((select id from fx where k='save-default'),(select id from fx where k='template'),null,(select v from data where k='default')),(select v from data where k='saved-default'),'Lost default acknowledgment recovers exact receipt');
select throws_ok($$select save_recurring_care_template((select id from fx where k='save-default'),(select id from fx where k='template'),null,(select v||'{"name":"Changed"}' from data where k='default'))$$,'23505',null,'Changed retry conflicts');
insert into fx select 'client',id from save_client(auth.uid(),null,null,'SYNTHETIC','CARE RECURRENCE','+12025550147','care-client@example.test','EMAIL',null,null);
insert into fx select 'pet',id from save_patient(null,(select id from fx where k='client'),null,'Synthetic care dog','Dog',null,null,'unknown',null,'unknown','unknown',null,null,null);
insert into fx select 'sibling',id from save_patient(null,(select id from fx where k='client'),null,'Synthetic living sibling','Dog',null,null,'unknown',null,'unknown','unknown',null,null,null);
insert into data values('plan-values',jsonb_build_object('template_id',(select id from fx where k='template'),'template_version',1,'name','Synthetic monthly care',
 'interval_amount',1,'interval_unit','months','anchor_mode','fixed_schedule','month_end','clamp','anchor_on','2026-01-31','due_on','2026-02-28',
 'status','current','reminders_enabled',true,'override_reason','','review_note','Synthetic patient clinical review','replace_anchor_evidence',false));
select set_config('request.jwt.claims','{"sub":"ac2b0000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select throws_ok($$select save_patient_care_plan((select id from fx where k='save-plan'),(select id from fx where k='plan'),(select id from fx where k='pet'),null,(select v from data where k='plan-values'))$$,'42501',null,'Staff cannot activate clinical plan');
select lives_ok($$select save_patient_care_plan((select id from fx where k='save-plan'),(select id from fx where k='plan'),(select id from fx where k='pet'),null,(select v||'{"status":"proposed","reminders_enabled":false}' from data where k='plan-values'))$$,'Staff may propose a plan');
select is(list_patient_care_plans((select id from fx where k='pet'))#>>'{rows,0,plan,status}','proposed','Proposal visible');
select set_config('request.jwt.claims','{"sub":"ac2b0000-0000-4000-8000-000000000001","role":"authenticated"}',true);
insert into data values('approved-plan',save_patient_care_plan(gen_random_uuid(),(select id from fx where k='plan'),(select id from fx where k='pet'),1,(select v from data where k='plan-values')));
select is((select v->>'approved_by' from data where k='approved-plan'),'ac2b0000-0000-4000-8000-000000000001','DVM identity stamped from actual caller');
select is((select v->>'version' from data where k='approved-plan'),'2','Review advances version');
select throws_ok($$select save_patient_care_plan(gen_random_uuid(),(select id from fx where k='plan'),(select id from fx where k='pet'),1,(select v from data where k='plan-values'))$$,'PT409',null,'Competing stale change rejected');
select throws_ok($$select save_patient_care_plan(gen_random_uuid(),(select id from fx where k='plan'),(select id from fx where k='sibling'),2,(select v from data where k='plan-values'))$$,'42501',null,'Patient association cannot be replaced');
select throws_ok($$select save_patient_care_plan(gen_random_uuid(),(select id from fx where k='plan'),(select id from fx where k='pet'),2,(select v||'{"interval_amount":3}' from data where k='plan-values'))$$,'23514',null,'Clinical override needs rationale');
select is(read_patient_care_plan((select id from fx where k='plan'),(select id from fx where k='sibling')),null::jsonb,'Wrong-patient detail returns no record');
select is(jsonb_array_length(list_care_plan_history((select id from fx where k='plan'),(select id from fx where k='pet'))->'rows'),2,'Proposal and review preserved in history');

insert into fx select 'product',id from save_catalog_product(null,null,'Synthetic completed exam','service','','visit',1000,true);
insert into fx select 'encounter',id from save_clinical_encounter(null,(select id from fx where k='pet'),null,'2026-01-01T18:00Z','clinic','','','','','');
select lives_ok($$select record_patient_service((select id from fx where k='service'),jsonb_build_object('pet_id',(select id from fx where k='pet'),
 'encounter_id',(select id from fx where k='encounter'),'product_id',(select id from fx where k='product'),'clinician_id',auth.uid(),
 'performed_at','2026-03-31T18:00:00Z','notes','Synthetic actual completed service','invoice_id',null))$$,'Actual service evidence recorded separately');
select is(jsonb_array_length(list_care_completion_sources((select id from fx where k='pet'))->'rows'),1,'Source picker contains actual eligible evidence');
select is(preview_care_plan_completion((select id from fx where k='plan'),(select id from fx where k='pet'),2,'service',(select id from fx where k='service'),1)->>'next_due_on','2026-04-30','Late completion advances to next original-anchor occurrence');
insert into data values('completion-request',jsonb_build_object('source_kind','service','source_id',(select id from fx where k='service'),'source_version',1,'review_note','Reviewed this actual care as satisfying the plan'));
insert into data values('completion',complete_patient_care_plan((select id from fx where k='complete'),(select id from fx where k='plan'),(select id from fx where k='pet'),2,(select v from data where k='completion-request')));
select is((select v#>>'{plan,due_on}' from data where k='completion'),'2026-04-30','Completion commits previewed next date');
select is((select v#>>'{plan,anchor_on}' from data where k='completion'),'2026-01-31','Fixed schedule retains original anchor');
select is((select v#>>'{plan,cycle_index}' from data where k='completion'),'3','Missed dates skipped without invented care');
select is(complete_patient_care_plan((select id from fx where k='complete'),(select id from fx where k='plan'),(select id from fx where k='pet'),2,(select v from data where k='completion-request')),(select v from data where k='completion'),'Lost completion acknowledgment recovers exact receipt');
select throws_ok($$select complete_patient_care_plan(gen_random_uuid(),(select id from fx where k='plan'),(select id from fx where k='pet'),3,(select v from data where k='completion-request'))$$,'23514',null,'Different action cannot reuse same physical care');
select isnt((select v#>>'{plan,occurrence_id}' from data where k='completion'),(select v->>'occurrence_id' from data where k='approved-plan'),'Completion creates a distinct next due occurrence');
select lives_ok($$select correct_patient_service((select id from fx where k='source-correction'),(select id from fx where k='pet'),(select id from fx where k='service'),'Synthetic source correction',null)$$,'Clinical evidence can be corrected through original workflow');
select is(read_patient_care_plan((select id from fx where k='plan'),(select id from fx where k='pet'))#>>'{plan,status}','proposed','Corrected evidence stops routine work pending review');
select is(jsonb_array_length(list_care_completion_sources((select id from fx where k='pet'))->'rows'),0,'Corrected source removed from completion choices');
select is(complete_patient_care_plan((select id from fx where k='complete'),(select id from fx where k='plan'),(select id from fx where k='pet'),2,(select v from data where k='completion-request')),(select v from data where k='completion'),'Historical completion receipt still recovers after correction');
select throws_ok($$select save_patient_care_plan(gen_random_uuid(),(select id from fx where k='plan'),(select id from fx where k='pet'),4,(select v||'{"due_on":"2026-04-30"}' from data where k='plan-values'))$$,'PT409',null,'Unchanged corrected anchor cannot silently resume');
select lives_ok($$select save_patient_care_plan(gen_random_uuid(),(select id from fx where k='plan'),(select id from fx where k='pet'),4,(select v||'{"due_on":"2026-04-30","replace_anchor_evidence":true,"override_reason":"Explicit reviewed baseline after source correction"}' from data where k='plan-values'))$$,'DVM may explicitly review a replacement baseline, retaining old evidence');

-- Channel policy is a separate administrative decision, with no seeded activation.
select lives_ok($$select save_care_message_template((select id from fx where k='message-template'),null,'Synthetic recurring wording','email',0,'{{patient_name}}: {{care_name}} due {{due_date}}',true,'Synthetic wording review')$$,'Existing wording reused');
select throws_ok($$select save_reminder_automation_policy((select id from fx where k='policy'),null,'care_plan','EMAIL',(select id from fx where k='message-template'),1,'Synthetic reminder',true,'Synthetic')$$,'23514',null,'Old policy endpoint cannot bypass reviewed send window');
insert into data values('policy',jsonb_build_object('channel','EMAIL','message_template_id',(select id from fx where k='message-template'),'message_template_version',1,
 'subject','Synthetic reminder','enabled',true,'review_note','Synthetic full-day test window','start_minute',0,'end_minute',1440));
select lives_ok($$select save_care_plan_delivery_policy(gen_random_uuid(),(select id from fx where k='policy'),null,(select v from data where k='policy'))$$,'Administrator saves reviewed recurring delivery window');
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select is((queue_due_reminders()->>'queued')::integer,1,'Current plan feeds existing canonical queue once');
select is((queue_due_reminders()->>'queued')::integer,0,'Repeated scheduler cannot duplicate handoff');
reset role;
select is((select count(*) from patient_service_events where id=(select id from fx where k='service')),1::bigint,'Completion does not create another clinical service');
select is((select count(*) from care_plan_completions where plan_id=(select id from fx where k='plan')),1::bigint,'Completion ledger remains immutable');
select throws_ok($$update care_plan_completions set review_note='Rewrite'$$,'23514',null,'Completion cannot be rewritten even by table owner');
select throws_ok($$delete from care_workflow_actions$$,'23514',null,'Receipts cannot be erased');
select is((select count(*) from care_reminder_jobs where source_kind='care_plan'),1::bigint,'One scheduled source job');
insert into fx select 'outbox',outbox_id from reminder_outbox_links where job_kind='care';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"ac2b0000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select lives_ok($$select save_patient((select id from fx where k='pet'),(select id from fx where k='client'),1,'Synthetic care dog','Dog',null,null,'unknown',null,'unknown','unknown',null,null,'2026-10-01')$$,'Death recorded through existing patient workflow');
select is(read_patient_care_plan((select id from fx where k='plan'),(select id from fx where k='pet'))#>>'{plan,status}','proposed','Death requires renewed review, rather than temporary deactivation only');
select is(read_patient_care_plan((select id from fx where k='plan'),(select id from fx where k='pet'))#>>'{patient_inactive}','true','Inactive patient remains readable');
select is(read_daily_communication('outbox',(select id from fx where k='outbox'))#>>'{record,status}','suppressed','Invalidated unstarted work is visibly suppressed');
select lives_ok($$select save_patient((select id from fx where k='pet'),(select id from fx where k='client'),2,'Synthetic care dog','Dog',null,null,'unknown',null,'unknown','unknown',null,null,null)$$,'Erroneous death status can be corrected');
select is(read_patient_care_plan((select id from fx where k='plan'),(select id from fx where k='pet'))#>>'{plan,status}','proposed','Restoring living status does not silently resume routine work');
reset role;
select ok((select deceased_at is null and archived_at is null from pets where id=(select id from fx where k='sibling')),'Living sibling untouched');
select * from finish();
rollback;
